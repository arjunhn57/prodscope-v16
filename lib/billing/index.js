"use strict";

/**
 * lib/billing — credit accounting + (deferred) Stripe checkout.
 *
 * Two layers, gated by different flags:
 *
 *   1. Local credit accounting (always active once schema migration runs).
 *      Backed by users.credits_remaining in SQLite. Public users get 1
 *      free credit on signup; chargeRun decrements on job start;
 *      refundRun re-credits on code-side fault. admin/design_partner
 *      roles are exempt — pre-pilot users never get gated.
 *
 *   2. Stripe checkout / webhooks — gated on BILLING_ENABLED. Off until
 *      3+ design-partner LOIs are signed. The freemium paywall today is
 *      a "Contact for upgrade" form, not a Stripe redirect; this layer
 *      stays inert until we flip the flag.
 *
 * Env contract:
 *   BILLING_ENABLED=true               (off by default — Stripe layer)
 *   STRIPE_SECRET_KEY=sk_live_...
 *   STRIPE_WEBHOOK_SECRET=whsec_...
 *   STRIPE_PRICE_PRE_AUTH=price_...    ($99 one-time)
 *   STRIPE_PRICE_FULL=price_...        ($499 one-time)
 *   STRIPE_PRICE_SUBSCRIPTION=price_... ($999/mo)
 */

const { logger } = require("../logger");
const store = require("../../jobs/store");

const log = logger.child({ component: "billing" });

const BILLING_ENABLED =
  String(process.env.BILLING_ENABLED || "").toLowerCase() === "true";

// Roles exempt from credit gating. Admins and design partners never have
// their balance touched — chargeRun returns ok with a `skipped` flag.
const EXEMPT_ROLES = new Set(["admin", "design_partner"]);

/**
 * @typedef {"pre_auth_report" | "full_report" | "diligence_subscription"} BillingTier
 */

/** @type {Record<BillingTier, { priceEnvVar: string; mode: "payment"|"subscription"; label: string }>} */
const TIER_CONFIG = {
  pre_auth_report: {
    priceEnvVar: "STRIPE_PRICE_PRE_AUTH",
    mode: "payment",
    label: "Pre-auth report",
  },
  full_report: {
    priceEnvVar: "STRIPE_PRICE_FULL",
    mode: "payment",
    label: "Full report",
  },
  diligence_subscription: {
    priceEnvVar: "STRIPE_PRICE_SUBSCRIPTION",
    mode: "subscription",
    label: "Diligence subscription",
  },
};

/**
 * Is the Stripe checkout layer live? Local credit accounting runs
 * regardless — this only gates real-money paths.
 */
function isEnabled() {
  return BILLING_ENABLED;
}

/**
 * Charge one credit against a user's balance before starting a job. Returns
 * a structured result the caller can convert to an HTTP response.
 *
 * Outcomes:
 *   { ok: true, skipped: true, reason: "role_exempt" }      admin / design_partner
 *   { ok: true, skipped: true, reason: "no_user" }          legacy/anon job (no userId)
 *   { ok: true, balanceAfter: number }                      decrement succeeded
 *   { ok: false, reason: "no_credits", balance: 0, ... }    paywall
 *   { ok: false, reason: "user_not_found" }                 caller passed a stale userId
 *   { ok: false, reason: "email_not_verified", ... }        when email gating enabled
 *
 * @param {{userId: string|null|undefined, jobId: string, tier?: BillingTier, deps?: {store?: object}}} args
 * @returns {Promise<{ok:true, skipped?:boolean, reason?:string, balanceAfter?:number} | {ok:false, reason:string, balance?:number, upgradeUrl?:string}>}
 */
async function chargeRun({ userId, jobId, tier, deps }) {
  const s = (deps && deps.store) || store;

  if (!userId) {
    log.warn({ jobId }, "billing: chargeRun called without userId — allowing through (legacy)");
    return { ok: true, skipped: true, reason: "no_user" };
  }

  const credits = s.getUserCredits(userId);
  if (!credits) {
    log.warn({ userId, jobId }, "billing: chargeRun user not found");
    return { ok: false, reason: "user_not_found" };
  }

  if (EXEMPT_ROLES.has(credits.role)) {
    log.info(
      { userId, jobId, role: credits.role },
      "billing: chargeRun skipped — role exempt",
    );
    return { ok: true, skipped: true, reason: "role_exempt" };
  }

  const result = s.decrementUserCredits(userId);
  if (!result.ok) {
    log.info(
      { userId, jobId, reason: result.reason, balance: result.balance, tier },
      "billing: chargeRun denied — insufficient credits",
    );
    return {
      ok: false,
      reason: "no_credits",
      balance: 0,
      upgradeUrl: "/pricing",
    };
  }

  log.info(
    { userId, jobId, balanceAfter: result.balanceAfter, tier },
    "billing: chargeRun ok",
  );
  return { ok: true, balanceAfter: result.balanceAfter };
}

/**
 * Refund the credit charged for a run when it terminated with a code-side
 * fault. Caller decides whether the run was a refundable fault — see
 * jobs/runner.js for the fault classification (auth_wall_reached is NOT a
 * fault — it's a successful pre-auth analysis).
 *
 * @param {{userId: string|null|undefined, jobId: string, reason: string, deps?: {store?: object}}} args
 * @returns {Promise<{ok:true, skipped?:boolean, balanceAfter?:number} | {ok:false, reason:string}>}
 */
async function refundRun({ userId, jobId, reason, deps }) {
  const s = (deps && deps.store) || store;

  if (!userId) {
    return { ok: true, skipped: true };
  }

  const credits = s.getUserCredits(userId);
  if (!credits) {
    log.warn({ userId, jobId, reason }, "billing: refundRun user not found");
    return { ok: false, reason: "user_not_found" };
  }

  if (EXEMPT_ROLES.has(credits.role)) {
    return { ok: true, skipped: true };
  }

  const result = s.incrementUserCredits(userId);
  if (!result.ok) {
    return { ok: false, reason: result.reason };
  }

  log.info(
    { userId, jobId, reason, balanceAfter: result.balanceAfter },
    "billing: refundRun ok",
  );
  return { ok: true, balanceAfter: result.balanceAfter };
}

/**
 * Read the current credit balance for a user. Returns null when the user
 * isn't in the table — caller should treat that as "anonymous, no balance."
 *
 * @param {string} userId
 * @param {{deps?: {store?: object}}} [opts]
 * @returns {Promise<null | {credits: number, role: string, emailVerified: boolean, exempt: boolean}>}
 */
async function getBalance(userId, opts) {
  const s = (opts && opts.deps && opts.deps.store) || store;
  if (!userId) return null;
  const row = s.getUserCredits(userId);
  if (!row) return null;
  return {
    credits: row.credits_remaining,
    role: row.role,
    emailVerified: row.email_verified === 1,
    exempt: EXEMPT_ROLES.has(row.role),
  };
}

/**
 * Create a Stripe Checkout session. Stays inert until BILLING_ENABLED=true.
 * Today the upload-paywall path on the frontend renders a "Contact us"
 * form instead — this is the slot that flips on once Stripe goes live.
 *
 * @param {{tier: BillingTier, userId: string, successUrl: string, cancelUrl: string}} args
 * @returns {Promise<{enabled:false, reason:string} | {enabled:true, sessionId:string, url:string}>}
 */
async function createCheckoutSession({ tier, userId, successUrl, cancelUrl }) {
  if (!isEnabled()) {
    log.info(
      { tier, userId, callsite: "createCheckoutSession" },
      "billing: stub call — Stripe disabled",
    );
    return { enabled: false, reason: "billing_disabled" };
  }
  void successUrl;
  void cancelUrl;
  log.warn({ tier, userId }, "billing: BILLING_ENABLED=true but Stripe client not yet implemented");
  throw new Error("billing_not_implemented");
}

/**
 * Verify a Stripe webhook signature. Inert until BILLING_ENABLED=true.
 *
 * @param {Buffer|string} rawBody
 * @param {string} signatureHeader
 * @returns {Promise<null | {type: string, data: object}>}
 */
async function verifyAndParseWebhook(rawBody, signatureHeader) {
  if (!isEnabled()) {
    log.info({ callsite: "verifyAndParseWebhook" }, "billing: webhook ping with Stripe disabled");
    return null;
  }
  void rawBody;
  void signatureHeader;
  throw new Error("billing_not_implemented");
}

module.exports = {
  isEnabled,
  chargeRun,
  refundRun,
  getBalance,
  createCheckoutSession,
  verifyAndParseWebhook,
  TIER_CONFIG,
  EXEMPT_ROLES,
};
