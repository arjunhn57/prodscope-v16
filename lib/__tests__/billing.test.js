"use strict";

/**
 * Tests for lib/billing.
 *
 * Two layers under test:
 *   - Local credit accounting (always active) — chargeRun, refundRun,
 *     getBalance against a mock store. Role exemption is the load-bearing
 *     branch — admin/design_partner must NEVER have their balance touched.
 *   - Stripe checkout layer (gated on BILLING_ENABLED) — stays inert until
 *     LOIs trigger the flip. Tests lock in the off-by-default contract.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const billing = require("../billing");

// ── Mock store factory ────────────────────────────────────────────────
//
// Mirrors the four functions billing.js calls on `store`:
//   getUserCredits, decrementUserCredits, incrementUserCredits, setUserEmailVerified.
// The mock keeps state in a plain Map so each test gets an isolated DB-equivalent.

function makeMockStore(initial = {}) {
  const users = new Map();
  for (const [id, row] of Object.entries(initial)) {
    users.set(id, {
      credits_remaining: row.credits_remaining ?? 1,
      email_verified: row.email_verified ?? 0,
      role: row.role ?? "public",
    });
  }

  return {
    users,
    getUserCredits(userId) {
      return users.get(userId) || null;
    },
    decrementUserCredits(userId) {
      const row = users.get(userId);
      if (!row) return { ok: false, reason: "user_not_found", balance: null };
      if (row.credits_remaining <= 0) {
        return { ok: false, reason: "no_credits", balance: 0 };
      }
      row.credits_remaining -= 1;
      return { ok: true, balanceAfter: row.credits_remaining };
    },
    incrementUserCredits(userId) {
      const row = users.get(userId);
      if (!row) return { ok: false, reason: "user_not_found" };
      row.credits_remaining += 1;
      return { ok: true, balanceAfter: row.credits_remaining };
    },
    setUserEmailVerified(userId, verified) {
      const row = users.get(userId);
      if (!row) return;
      row.email_verified = verified ? 1 : 0;
    },
  };
}

// ── Stripe layer (gated, stays disabled in test env) ──────────────────

test("isEnabled: returns false when BILLING_ENABLED is unset", () => {
  assert.equal(billing.isEnabled(), false);
});

test("createCheckoutSession: returns billing_disabled stub when off", async () => {
  const result = await billing.createCheckoutSession({
    tier: "pre_auth_report",
    userId: "u_test",
    successUrl: "https://example.com/ok",
    cancelUrl: "https://example.com/cancel",
  });
  assert.equal(result.enabled, false);
  assert.equal(result.reason, "billing_disabled");
});

test("verifyAndParseWebhook: returns null when off (so route can 200-OK)", async () => {
  const result = await billing.verifyAndParseWebhook(
    Buffer.from("{}"),
    "t=12345,v1=fakesig",
  );
  assert.equal(result, null);
});

test("TIER_CONFIG: has the three planned V1 tiers with valid modes", () => {
  assert.ok(billing.TIER_CONFIG.pre_auth_report);
  assert.equal(billing.TIER_CONFIG.pre_auth_report.mode, "payment");
  assert.ok(billing.TIER_CONFIG.full_report);
  assert.equal(billing.TIER_CONFIG.full_report.mode, "payment");
  assert.ok(billing.TIER_CONFIG.diligence_subscription);
  assert.equal(billing.TIER_CONFIG.diligence_subscription.mode, "subscription");
});

// ── chargeRun ─────────────────────────────────────────────────────────

test("chargeRun: public user with credits — decrement succeeds", async () => {
  const store = makeMockStore({
    u_pub: { role: "public", credits_remaining: 1 },
  });
  const r = await billing.chargeRun({
    userId: "u_pub",
    jobId: "job_a",
    deps: { store },
  });
  assert.equal(r.ok, true);
  assert.equal(r.balanceAfter, 0);
  assert.equal(store.users.get("u_pub").credits_remaining, 0);
});

test("chargeRun: public user with zero credits — paywall response", async () => {
  const store = makeMockStore({
    u_broke: { role: "public", credits_remaining: 0 },
  });
  const r = await billing.chargeRun({
    userId: "u_broke",
    jobId: "job_b",
    deps: { store },
  });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "no_credits");
  assert.equal(r.balance, 0);
  assert.equal(r.upgradeUrl, "/pricing");
  // Balance must not have gone negative.
  assert.equal(store.users.get("u_broke").credits_remaining, 0);
});

test("chargeRun: admin role is exempt — balance untouched", async () => {
  const store = makeMockStore({
    u_admin: { role: "admin", credits_remaining: 1 },
  });
  const r = await billing.chargeRun({
    userId: "u_admin",
    jobId: "job_c",
    deps: { store },
  });
  assert.equal(r.ok, true);
  assert.equal(r.skipped, true);
  assert.equal(r.reason, "role_exempt");
  // Balance not decremented for exempt roles.
  assert.equal(store.users.get("u_admin").credits_remaining, 1);
});

test("chargeRun: design_partner role is exempt — balance untouched", async () => {
  const store = makeMockStore({
    u_dp: { role: "design_partner", credits_remaining: 5 },
  });
  const r = await billing.chargeRun({
    userId: "u_dp",
    jobId: "job_d",
    deps: { store },
  });
  assert.equal(r.ok, true);
  assert.equal(r.skipped, true);
  assert.equal(store.users.get("u_dp").credits_remaining, 5);
});

test("chargeRun: missing userId — allowed through (legacy path)", async () => {
  const store = makeMockStore({});
  const r = await billing.chargeRun({
    userId: null,
    jobId: "job_e",
    deps: { store },
  });
  assert.equal(r.ok, true);
  assert.equal(r.skipped, true);
  assert.equal(r.reason, "no_user");
});

test("chargeRun: stale userId not in DB — user_not_found", async () => {
  const store = makeMockStore({});
  const r = await billing.chargeRun({
    userId: "u_ghost",
    jobId: "job_f",
    deps: { store },
  });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "user_not_found");
});

// ── refundRun ─────────────────────────────────────────────────────────

test("refundRun: public user — increments balance", async () => {
  const store = makeMockStore({
    u_pub: { role: "public", credits_remaining: 0 },
  });
  const r = await billing.refundRun({
    userId: "u_pub",
    jobId: "job_g",
    reason: "api_error",
    deps: { store },
  });
  assert.equal(r.ok, true);
  assert.equal(r.balanceAfter, 1);
  assert.equal(store.users.get("u_pub").credits_remaining, 1);
});

test("refundRun: admin role — skipped, balance unchanged", async () => {
  const store = makeMockStore({
    u_admin: { role: "admin", credits_remaining: 1 },
  });
  const r = await billing.refundRun({
    userId: "u_admin",
    jobId: "job_h",
    reason: "api_error",
    deps: { store },
  });
  assert.equal(r.ok, true);
  assert.equal(r.skipped, true);
  // Admin balance must not be incremented either.
  assert.equal(store.users.get("u_admin").credits_remaining, 1);
});

test("refundRun: missing userId — skipped (legacy path)", async () => {
  const store = makeMockStore({});
  const r = await billing.refundRun({
    userId: null,
    jobId: "job_i",
    reason: "api_error",
    deps: { store },
  });
  assert.equal(r.ok, true);
  assert.equal(r.skipped, true);
});

// ── End-to-end: charge then refund ────────────────────────────────────

test("chargeRun + refundRun: net zero balance change on faulted run", async () => {
  const store = makeMockStore({
    u_pub: { role: "public", credits_remaining: 1 },
  });
  await billing.chargeRun({ userId: "u_pub", jobId: "j", deps: { store } });
  assert.equal(store.users.get("u_pub").credits_remaining, 0);
  await billing.refundRun({
    userId: "u_pub",
    jobId: "j",
    reason: "unrecoverable_drift",
    deps: { store },
  });
  assert.equal(store.users.get("u_pub").credits_remaining, 1);
});

// ── getBalance ────────────────────────────────────────────────────────

test("getBalance: public user — returns credits + role + exempt=false", async () => {
  const store = makeMockStore({
    u_pub: { role: "public", credits_remaining: 1, email_verified: 1 },
  });
  const r = await billing.getBalance("u_pub", { deps: { store } });
  assert.deepEqual(r, {
    credits: 1,
    role: "public",
    emailVerified: true,
    exempt: false,
  });
});

test("getBalance: design partner — exempt=true", async () => {
  const store = makeMockStore({
    u_dp: { role: "design_partner", credits_remaining: 0, email_verified: 1 },
  });
  const r = await billing.getBalance("u_dp", { deps: { store } });
  assert.equal(r.exempt, true);
  assert.equal(r.role, "design_partner");
});

test("getBalance: missing userId — returns null", async () => {
  const store = makeMockStore({});
  const r = await billing.getBalance(null, { deps: { store } });
  assert.equal(r, null);
});

test("getBalance: unknown userId — returns null", async () => {
  const store = makeMockStore({});
  const r = await billing.getBalance("u_ghost", { deps: { store } });
  assert.equal(r, null);
});
