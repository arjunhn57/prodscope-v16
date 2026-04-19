"use strict";

const { describe, it, before } = require("node:test");
const assert = require("node:assert");
const os = require("os");
const path = require("path");
const fs = require("fs");

// Use an isolated SQLite file so the test doesn't pollute the dev DB.
const TMP_DB = path.join(os.tmpdir(), `users-test-${Date.now()}-${process.pid}.db`);
process.env.DB_PATH = TMP_DB;
process.env.ADMIN_EMAILS = "admin@example.com,arjunhn57@gmail.com";

const store = require("../store");

describe("store users (Phase 7 Day 1)", () => {
  before(() => {
    // Ensure tables exist — store.js creates them on require
    store.db.prepare("DELETE FROM users").run();
  });

  it("upsertUserFromGoogle creates a new user on first call", () => {
    const user = store.upsertUserFromGoogle({
      googleId: "g-123",
      email: "founder@example.com",
      name: "Test Founder",
      picture: "https://example.com/pic.jpg",
    });
    assert.ok(user.id.startsWith("u_"));
    assert.strictEqual(user.email, "founder@example.com");
    assert.strictEqual(user.google_id, "g-123");
    assert.strictEqual(user.name, "Test Founder");
    assert.strictEqual(user.role, "public");
    assert.ok(user.last_login_at);
  });

  it("upsertUserFromGoogle updates last_login_at on repeat call", async () => {
    const first = store.upsertUserFromGoogle({
      googleId: "g-456",
      email: "repeat@example.com",
      name: "Repeat User",
    });
    // Ensure SQLite CURRENT_TIMESTAMP actually ticks (resolution is 1s)
    await new Promise((r) => setTimeout(r, 1100));
    const second = store.upsertUserFromGoogle({
      googleId: "g-456",
      email: "repeat@example.com",
      name: "Repeat User Updated",
      picture: "https://new.pic/",
    });
    assert.strictEqual(first.id, second.id);
    assert.strictEqual(second.name, "Repeat User Updated");
    assert.strictEqual(second.picture, "https://new.pic/");
    assert.notStrictEqual(first.last_login_at, second.last_login_at);
  });

  it("assigns admin role to emails in ADMIN_EMAILS (case-insensitive)", () => {
    const admin = store.upsertUserFromGoogle({
      googleId: "g-admin",
      email: "ARJUNHN57@gmail.com",
    });
    assert.strictEqual(admin.role, "admin");
  });

  it("assigns public role to non-admin emails", () => {
    const user = store.upsertUserFromGoogle({
      googleId: "g-public",
      email: "random@example.com",
    });
    assert.strictEqual(user.role, "public");
  });

  it("getUserByEmail returns null for unknown email", () => {
    assert.strictEqual(store.getUserByEmail("nobody@example.com"), null);
  });

  it("getUserById returns the user record", () => {
    const created = store.upsertUserFromGoogle({
      googleId: "g-lookup",
      email: "lookup@example.com",
    });
    const fetched = store.getUserById(created.id);
    assert.strictEqual(fetched.email, "lookup@example.com");
  });

  it("setUserRole updates the role for a known user", () => {
    const created = store.upsertUserFromGoogle({
      googleId: "g-role",
      email: "role@example.com",
    });
    const updated = store.setUserRole(created.id, "design_partner");
    assert.strictEqual(updated.role, "design_partner");
  });

  it("setUserRole rejects unknown role", () => {
    const created = store.upsertUserFromGoogle({
      googleId: "g-badrole",
      email: "badrole@example.com",
    });
    assert.throws(() => store.setUserRole(created.id, "superadmin"), /Invalid role/);
  });

  it("email uniqueness is enforced (upsert path, not insert)", () => {
    // Two different googleIds for same email should reuse the same user row
    const a = store.upsertUserFromGoogle({ googleId: "g-unique-a", email: "unique@example.com" });
    const b = store.upsertUserFromGoogle({ googleId: "g-unique-b", email: "unique@example.com" });
    assert.strictEqual(a.id, b.id);
    assert.strictEqual(b.google_id, "g-unique-b"); // latest google_id wins
  });
});

// Cleanup — delete the temp DB after the test process exits
process.on("exit", () => {
  try { fs.unlinkSync(TMP_DB); } catch (_) {}
  try { fs.unlinkSync(TMP_DB + "-wal"); } catch (_) {}
  try { fs.unlinkSync(TMP_DB + "-shm"); } catch (_) {}
});
