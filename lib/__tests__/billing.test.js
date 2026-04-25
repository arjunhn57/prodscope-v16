"use strict";

/**
 * Tests for lib/billing — the stub billing module.
 *
 * Today billing is intentionally disabled (BILLING_ENABLED is unset or
 * "false") because the product is in design-partner mode, not paid
 * Stripe checkout. These tests lock in that off-by-default contract so
 * a future commit can't accidentally turn billing on without flipping
 * the env flag.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const billing = require("../billing");

test("isEnabled: returns false when BILLING_ENABLED is unset", () => {
  // Tests run with BILLING_ENABLED unset, so this is the default state.
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

test("chargeRun: returns enabled=false stub when off", async () => {
  const result = await billing.chargeRun({
    userId: "u_test",
    jobId: "job_test",
    tier: "pre_auth_report",
  });
  assert.equal(result.enabled, false);
});

test("refundRun: returns enabled=false stub when off", async () => {
  const result = await billing.refundRun({
    userId: "u_test",
    jobId: "job_test",
    reason: "auth_wall_reached",
  });
  assert.equal(result.enabled, false);
});

test("getBalance: returns null when off", async () => {
  const result = await billing.getBalance("u_test");
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
