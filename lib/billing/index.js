"use strict";

/**
 * lib/billing — billing layer stub.
 *
 * Currently the product is in "design partner" mode — free for approved
 * users, billing launches publicly only once 3+ design-partner LOIs are
 * signed. So Stripe is intentionally NOT live yet. This module exposes
 * the future API surface (checkout sessions, webhooks, credit
 * decrement / refund) as no-ops gated by BILLING_ENABLED. When Stripe
 * goes live, only the internals change — call sites stay stable.
 *
 * Env contract:
 *   BILLING_ENABLED=true               (off by default)
 *   STRIPE_SECRET_KEY=sk_live_...
 *   STRIPE_WEBHOOK_SECRET=whsec_...
 *   STRIPE_PRICE_PRE_AUTH=price_...    ($99 one-time)
 *   STRIPE_PRICE_FULL=price_...        ($499 one-time)
 *   STRIPE_PRICE_SUBSCRIPTION=price_... ($999/mo)
 *
 * When BILLING_ENABLED is not "true", every method returns
 * { enabled: false, reason: "billing_disabled" } and logs a single
 * info-level breadcrumb so we can audit who's calling billing surface
 * before Stripe goes live.
 */

const { logger } = require("../logger");

const log = logger.child({ component: "billing" });

const BILLING_ENABLED =
  String(process.env.BILLING_ENABLED || "").toLowerCase() === "true";

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
 * Is billing live right now?
 * @returns {boolean}
 */
function isEnabled() {
  return BILLING_ENABLED;
}

/**
 * Create a Stripe Checkout session for the given user + tier. Caller
 * redirects the browser to the returned `url`. When billing is
 * disabled, returns a stub indicating so — frontend should fall back
 * to the "design partner" application flow.
 *
 * @param {{tier: BillingTier, userId: string, successUrl: string, cancelUrl: string}} args
 * @returns {Promise<{enabled:false, reason:string} | {enabled:true, sessionId:string, url:string}>}
 */
async function createCheckoutSession({ tier, userId, successUrl, cancelUrl }) {
  if (!isEnabled()) {
    log.info(
      { tier, userId, callsite: "createCheckoutSession" },
      "billing: stub call — billing disabled",
    );
    return { enabled: false, reason: "billing_disabled" };
  }
  // V1.5 implementation: instantiate Stripe client, look up
  // TIER_CONFIG[tier].priceEnvVar, create a checkout session in the
  // configured mode, attach metadata { userId, tier }, return
  // { sessionId, url }. Until then, defensively reject so a
  // misconfigured BILLING_ENABLED=true doesn't 500 the user.
  log.warn({ tier, userId }, "billing: BILLING_ENABLED=true but Stripe client not yet implemented");
  throw new Error("billing_not_implemented");
}

/**
 * Verify a Stripe webhook signature and return the event payload. When
 * billing is disabled this returns null so the route can 200-OK
 * incoming pings without doing anything.
 *
 * @param {Buffer|string} rawBody
 * @param {string} signatureHeader
 * @returns {Promise<null | {type: string, data: object}>}
 */
async function verifyAndParseWebhook(rawBody, signatureHeader) {
  if (!isEnabled()) {
    log.info({ callsite: "verifyAndParseWebhook" }, "billing: webhook ping with billing disabled");
    return null;
  }
  // V1.5: stripe.webhooks.constructEvent(rawBody, signatureHeader, STRIPE_WEBHOOK_SECRET).
  // Until then, refuse — better to 500 a real Stripe ping than silently accept noise.
  // The signature param is consumed by the stub call shape so callers
  // don't have to special-case the disabled path.
  void signatureHeader;
  throw new Error("billing_not_implemented");
}

/**
 * Charge a single run against the user's entitlements. Today this is a
 * no-op — quota is enforced via the existing tier/usage system in the
 * auth store. When billing is live this becomes a credit decrement +
 * audit-log write.
 *
 * @param {{userId: string, jobId: string, tier?: BillingTier}} args
 * @returns {Promise<{enabled:false} | {enabled:true, balanceAfter:number}>}
 */
async function chargeRun({ userId, jobId, tier }) {
  if (!isEnabled()) return { enabled: false };
  // V1.5: decrement credits, write audit row. Tier hint informs which
  // bucket to draw from when multiple are active.
  void userId;
  void jobId;
  void tier;
  throw new Error("billing_not_implemented");
}

/**
 * Refund the credit charged for a run when the run terminates with a
 * service-side failure (api_error, unrecoverable_drift, < min unique
 * screens). Today this is a no-op; when live it becomes a credit
 * increment + audit-log write.
 *
 * @param {{userId: string, jobId: string, reason: string}} args
 * @returns {Promise<{enabled:false} | {enabled:true, balanceAfter:number}>}
 */
async function refundRun({ userId, jobId, reason }) {
  if (!isEnabled()) return { enabled: false };
  void userId;
  void jobId;
  void reason;
  throw new Error("billing_not_implemented");
}

/**
 * Get the current credit balance for a user. Today this returns null
 * because the existing tier/usage system on the frontend handles quota
 * display. When billing is live this becomes a DB read.
 *
 * @param {string} userId
 * @returns {Promise<null | {credits: number, tier: BillingTier | null}>}
 */
async function getBalance(userId) {
  if (!isEnabled()) return null;
  void userId;
  throw new Error("billing_not_implemented");
}

module.exports = {
  isEnabled,
  createCheckoutSession,
  verifyAndParseWebhook,
  chargeRun,
  refundRun,
  getBalance,
  TIER_CONFIG,
};
