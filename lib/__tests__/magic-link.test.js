"use strict";

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert");

// Need to set secret BEFORE requiring module
const ORIGINAL_SECRET = process.env.MAGIC_LINK_SECRET;
const ORIGINAL_APP_URL = process.env.PUBLIC_APP_URL;
process.env.MAGIC_LINK_SECRET = "a".repeat(48);
process.env.PUBLIC_APP_URL = "https://prodscope.example.com";

const magicLink = require("../magic-link");

describe("magic-link", () => {
  after(() => {
    if (ORIGINAL_SECRET === undefined) delete process.env.MAGIC_LINK_SECRET;
    else process.env.MAGIC_LINK_SECRET = ORIGINAL_SECRET;
    if (ORIGINAL_APP_URL === undefined) delete process.env.PUBLIC_APP_URL;
    else process.env.PUBLIC_APP_URL = ORIGINAL_APP_URL;
  });

  it("signJobToken returns a deterministic hex string", () => {
    const a = magicLink.signJobToken("job-123");
    const b = magicLink.signJobToken("job-123");
    assert.strictEqual(a, b);
    assert.ok(/^[0-9a-f]{64}$/.test(a), `expected hex-64, got ${a}`);
  });

  it("signJobToken returns different tokens for different job ids", () => {
    const a = magicLink.signJobToken("job-abc");
    const b = magicLink.signJobToken("job-def");
    assert.notStrictEqual(a, b);
  });

  it("verifyJobToken accepts a valid token", () => {
    const token = magicLink.signJobToken("job-verify");
    assert.strictEqual(magicLink.verifyJobToken("job-verify", token), true);
  });

  it("verifyJobToken rejects a tampered token", () => {
    const token = magicLink.signJobToken("job-tamper");
    // Flip the first character
    const tampered = (token[0] === "0" ? "1" : "0") + token.slice(1);
    assert.strictEqual(magicLink.verifyJobToken("job-tamper", tampered), false);
  });

  it("verifyJobToken rejects a token from a different job id", () => {
    const token = magicLink.signJobToken("job-other");
    assert.strictEqual(magicLink.verifyJobToken("job-mine", token), false);
  });

  it("verifyJobToken rejects empty/missing input", () => {
    assert.strictEqual(magicLink.verifyJobToken("", "anything"), false);
    assert.strictEqual(magicLink.verifyJobToken("job", ""), false);
    assert.strictEqual(magicLink.verifyJobToken("job", null), false);
    assert.strictEqual(magicLink.verifyJobToken(null, "tok"), false);
  });

  it("buildShareUrl produces a valid URL with default base", () => {
    const url = magicLink.buildShareUrl("job-url");
    assert.ok(url.startsWith("https://prodscope.example.com/r/"), url);
    assert.ok(url.includes("?token="), url);
    // Reparse and verify the token matches
    const u = new URL(url);
    const token = u.searchParams.get("token");
    assert.strictEqual(magicLink.verifyJobToken("job-url", token), true);
  });

  it("buildShareUrl accepts a custom base URL", () => {
    const url = magicLink.buildShareUrl("job-custom", "http://localhost:5173");
    assert.ok(url.startsWith("http://localhost:5173/r/"), url);
  });

  it("buildShareUrl strips trailing slashes from base URL", () => {
    const url = magicLink.buildShareUrl("job-trim", "http://localhost:5173///");
    assert.ok(url.startsWith("http://localhost:5173/r/"), url);
  });

  it("isConfigured returns true when secret is set and long enough", () => {
    assert.strictEqual(magicLink.isConfigured(), true);
  });
});

describe("magic-link without secret", () => {
  const prev = process.env.MAGIC_LINK_SECRET;
  before(() => {
    delete process.env.MAGIC_LINK_SECRET;
  });
  after(() => {
    process.env.MAGIC_LINK_SECRET = prev;
  });

  it("signJobToken returns null when secret is missing", () => {
    assert.strictEqual(magicLink.signJobToken("job"), null);
  });

  it("verifyJobToken returns false when secret is missing", () => {
    assert.strictEqual(magicLink.verifyJobToken("job", "anything"), false);
  });

  it("buildShareUrl returns null when secret is missing", () => {
    assert.strictEqual(magicLink.buildShareUrl("job"), null);
  });

  it("isConfigured returns false when secret is missing", () => {
    assert.strictEqual(magicLink.isConfigured(), false);
  });
});

describe("magic-link with short secret", () => {
  const prev = process.env.MAGIC_LINK_SECRET;
  before(() => {
    process.env.MAGIC_LINK_SECRET = "too-short";
  });
  after(() => {
    process.env.MAGIC_LINK_SECRET = prev;
  });

  it("signJobToken returns null when secret is too short (<32 chars)", () => {
    assert.strictEqual(magicLink.signJobToken("job"), null);
  });

  it("isConfigured returns false when secret is too short", () => {
    assert.strictEqual(magicLink.isConfigured(), false);
  });
});
