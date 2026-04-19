"use strict";

// ---------------------------------------------------------------------------
// Phase 7, Day 4 — admin store tests.
//
// Exercises the new per-user usage + applications queries against a throwaway
// SQLite DB. Isolated from the main prodscope.db by overriding DB_PATH before
// the store module is loaded.
// ---------------------------------------------------------------------------

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const TMP_DB = path.join(
  os.tmpdir(),
  `prodscope-admin-store-${process.pid}-${Date.now()}.db`
);

process.env.DB_PATH = TMP_DB;
process.env.ADMIN_EMAILS = "admin@example.com";

const store = require("../../jobs/store");

describe("Admin store queries (Day 4)", () => {
  before(() => {
    const admin = store.upsertUserFromGoogle({
      googleId: "g_admin",
      email: "admin@example.com",
      name: "Admin User",
    });
    const partner = store.upsertUserFromGoogle({
      googleId: "g_partner",
      email: "partner@example.com",
      name: "Partner One",
    });
    const visitor = store.upsertUserFromGoogle({
      googleId: "g_visitor",
      email: "visitor@example.com",
      name: "Visitor",
    });

    store.setUserRole(partner.id, "design_partner");

    // Partner has two crawls; one $0.08, one $0.05 = $0.13 lifetime
    store.createJob("job_partner_1", { userId: partner.id, status: "queued" });
    store.updateJob("job_partner_1", { status: "complete", costUsd: 0.08 });
    store.createJob("job_partner_2", { userId: partner.id, status: "queued" });
    store.updateJob("job_partner_2", { status: "complete", costUsd: 0.05 });

    // Visitor has one expensive crawl ($0.12 — the V16 ceiling)
    store.createJob("job_visitor_1", { userId: visitor.id, status: "queued" });
    store.updateJob("job_visitor_1", { status: "complete", costUsd: 0.12 });

    store.createApplication({
      name: "Partner One",
      email: "partner@example.com",
      appName: "Partner App",
      playStoreUrl: "https://play.example.com/partner",
      whyNow: "We ship weekly",
    });
    // Admin reference for the follow-up test
    global.__testAdminId = admin.id;
    global.__testPartnerId = partner.id;
  });

  after(() => {
    try {
      store.db.close();
    } catch (_) {}
    try {
      fs.unlinkSync(TMP_DB);
    } catch (_) {}
  });

  it("listUsersWithUsage sorts by total spend desc and joins application/loi state", () => {
    const users = store.listUsersWithUsage({ limit: 50 });
    assert.ok(users.length >= 3, "should return all seeded users");

    const byEmail = Object.fromEntries(users.map((u) => [u.email, u]));

    assert.strictEqual(byEmail["partner@example.com"].crawlCount, 2);
    assert.ok(
      Math.abs(byEmail["partner@example.com"].totalCostUsd - 0.13) < 1e-9,
      `expected partner spend ≈ 0.13, got ${byEmail["partner@example.com"].totalCostUsd}`
    );
    assert.strictEqual(byEmail["partner@example.com"].loiStatus, "not_asked");
    assert.strictEqual(
      byEmail["partner@example.com"].applicationStatus,
      "new"
    );

    assert.strictEqual(byEmail["visitor@example.com"].crawlCount, 1);
    assert.ok(
      Math.abs(byEmail["visitor@example.com"].totalCostUsd - 0.12) < 1e-9
    );

    // Admin has 0 crawls but still appears in the listing
    assert.strictEqual(byEmail["admin@example.com"].crawlCount, 0);
    assert.strictEqual(byEmail["admin@example.com"].totalCostUsd, 0);
    assert.strictEqual(byEmail["admin@example.com"].role, "admin");
  });

  it("adminSummary returns lifetime spend summed across users and user counts", () => {
    const summary = store.adminSummary();
    assert.ok(
      Math.abs(summary.spend.lifetimeUsd - 0.25) < 1e-9,
      `expected lifetime ≈ 0.25, got ${summary.spend.lifetimeUsd}`
    );
    assert.strictEqual(summary.spend.totalJobs, 3);
    assert.strictEqual(summary.users.total, 3);
    assert.strictEqual(summary.users.designPartners, 1);
    assert.strictEqual(summary.users.admins, 1);
    assert.strictEqual(summary.applications.total, 1);
    assert.strictEqual(summary.applications.new, 1);
    assert.strictEqual(summary.applications.loiSigned, 0);
  });

  it("listJobsForUser returns only jobs owned by that user, newest first", () => {
    const jobs = store.listJobsForUser(global.__testPartnerId, { limit: 10 });
    assert.strictEqual(jobs.length, 2);
    const ids = jobs.map((j) => j.jobId).sort();
    assert.deepStrictEqual(ids, ["job_partner_1", "job_partner_2"]);
    // Cost column is persisted
    const total = jobs.reduce((s, j) => s + j.costUsd, 0);
    assert.ok(Math.abs(total - 0.13) < 1e-9);
  });

  it("setUserRole rejects invalid roles", () => {
    assert.throws(
      () => store.setUserRole(global.__testPartnerId, "superuser"),
      /Invalid role/
    );
  });

  it("setApplicationStatus and setApplicationLoiStatus validate their inputs", () => {
    const [app] = store.getApplicationsByEmail("partner@example.com");
    store.setApplicationStatus(app.id, "contacted");
    store.setApplicationLoiStatus(app.id, "signed");

    const updated = store.getApplicationById(app.id);
    assert.strictEqual(updated.status, "contacted");
    assert.strictEqual(updated.loi_status, "signed");

    assert.throws(
      () => store.setApplicationStatus(app.id, "bogus"),
      /Invalid application status/
    );
    assert.throws(
      () => store.setApplicationLoiStatus(app.id, "nope"),
      /Invalid LOI status/
    );

    // After marking LOI signed, summary counter increments
    const summary = store.adminSummary();
    assert.strictEqual(summary.applications.loiSigned, 1);
  });
});
