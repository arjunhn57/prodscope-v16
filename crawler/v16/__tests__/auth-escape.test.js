"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  findAuthEscapeButton,
  AUTH_ESCAPE_LABELS,
  AUTH_ESCAPE_REGEX,
} = require("../auth-escape");

// ── XML fixture helpers ────────────────────────────────────────────────

/**
 * Wrap a flat list of nodes into a minimal UIAutomator XML dump envelope.
 * The regex-based finder only inspects <node .../> so we skip hierarchy
 * complexity in fixtures — that matches what the v15 parser expects.
 */
function wrap(...innerNodes) {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<hierarchy rotation="0">\n${innerNodes.join("\n")}\n</hierarchy>`;
}

function node({ text = "", desc = "", clickable = true, bounds = "[0,0][0,0]", cls = "android.widget.TextView" }) {
  return `<node index="0" text="${text}" resource-id="" class="${cls}" package="com.example" content-desc="${desc}" checkable="false" checked="false" clickable="${clickable}" enabled="true" focusable="true" focused="false" scrollable="false" long-clickable="false" password="false" selected="false" bounds="${bounds}" />`;
}

// ── Basic shape + exports ─────────────────────────────────────────────

test("AUTH_ESCAPE_LABELS is non-empty and ordered most-specific first", () => {
  assert.ok(AUTH_ESCAPE_LABELS.length >= 20, "need enough labels to cover common variants");
  // "continue as guest" should come before the generic "skip" — specificity matters
  const guestIdx = AUTH_ESCAPE_LABELS.indexOf("continue as guest");
  const skipIdx = AUTH_ESCAPE_LABELS.indexOf("skip");
  assert.ok(guestIdx >= 0 && skipIdx >= 0);
  assert.ok(guestIdx < skipIdx, "specific 'continue as guest' must come before generic 'skip'");
});

test("AUTH_ESCAPE_REGEX matches expected variants", () => {
  assert.match("Skip", AUTH_ESCAPE_REGEX);
  assert.match("Not Now", AUTH_ESCAPE_REGEX);
  assert.match("Continue as Guest", AUTH_ESCAPE_REGEX);
  assert.doesNotMatch("Sign In", AUTH_ESCAPE_REGEX);
  assert.doesNotMatch("Create Account", AUTH_ESCAPE_REGEX);
});

// ── Fixture 1: Browse-as-guest screen (happy case) ─────────────────────

test("findAuthEscapeButton: returns guest button on 'Browse as guest' screen", () => {
  const xml = wrap(
    node({ text: "Welcome to Acme", clickable: false, bounds: "[0,200][1080,400]" }),
    node({ text: "Sign in", clickable: true, bounds: "[100,1400][980,1520]", cls: "android.widget.Button" }),
    node({ text: "Browse as guest", clickable: true, bounds: "[100,1600][980,1720]", cls: "android.widget.Button" }),
  );
  const r = findAuthEscapeButton({ xml });
  assert.ok(r, "expected a match");
  assert.equal(r.label, "Browse as guest");
  assert.equal(r.source, "xml");
  assert.equal(r.x, 540); // (100+980)/2
  assert.equal(r.y, 1660); // (1600+1720)/2
});

// ── Fixture 2: SaaS email login (no escape available) ──────────────────

test("findAuthEscapeButton: returns null on happy-path email login form (no escape)", () => {
  const xml = wrap(
    node({ text: "Sign in to Acme", clickable: false, bounds: "[0,200][1080,300]" }),
    node({ text: "", desc: "Email", clickable: true, bounds: "[80,500][1000,620]", cls: "android.widget.EditText" }),
    node({ text: "", desc: "Password", clickable: true, bounds: "[80,680][1000,800]", cls: "android.widget.EditText" }),
    node({ text: "Sign In", clickable: true, bounds: "[80,900][1000,1020]", cls: "android.widget.Button" }),
    node({ text: "Forgot password?", clickable: true, bounds: "[80,1060][1000,1120]" }),
  );
  const r = findAuthEscapeButton({ xml });
  assert.equal(r, null, "no skip/guest/close button on this screen");
});

// ── Fixture 3: Phone-OTP wall with Skip option ─────────────────────────

test("findAuthEscapeButton: finds Skip on phone-OTP wall when offered", () => {
  const xml = wrap(
    node({ text: "Enter your phone number", clickable: false, bounds: "[0,200][1080,300]" }),
    node({ text: "", desc: "Phone", clickable: true, bounds: "[80,500][1000,620]", cls: "android.widget.EditText" }),
    node({ text: "Send code", clickable: true, bounds: "[80,700][1000,820]", cls: "android.widget.Button" }),
    node({ text: "Skip", clickable: true, bounds: "[900,80][1040,180]", cls: "android.widget.TextView" }),
  );
  const r = findAuthEscapeButton({ xml });
  assert.ok(r);
  assert.equal(r.label.toLowerCase(), "skip");
  assert.equal(r.x, 970);
  assert.equal(r.y, 130);
});

// ── Fixture 4: Truly blocked phone-OTP (no skip, biztoso-style) ─────────

test("findAuthEscapeButton: returns null on hard-blocked phone-OTP (biztoso-style)", () => {
  const xml = wrap(
    node({ text: "Welcome", clickable: false, bounds: "[0,200][1080,300]" }),
    node({ text: "", desc: "Phone number", clickable: true, bounds: "[80,500][1000,620]", cls: "android.widget.EditText" }),
    node({ text: "Continue", clickable: true, bounds: "[80,700][1000,820]", cls: "android.widget.Button" }),
    node({ text: "By continuing you agree to the Terms of Service", clickable: false, bounds: "[0,900][1080,960]" }),
  );
  const r = findAuthEscapeButton({ xml });
  assert.equal(r, null);
});

// ── Fixture 5: Non-auth screen (wikipedia-style, no false positive) ─────

test("findAuthEscapeButton: returns null on non-auth content screen", () => {
  const xml = wrap(
    node({ text: "Article: Photosynthesis", clickable: false, bounds: "[0,200][1080,300]" }),
    node({ text: "Read more", clickable: true, bounds: "[80,900][400,1000]", cls: "android.widget.Button" }),
    node({ text: "Share", clickable: true, bounds: "[500,900][700,1000]", cls: "android.widget.Button" }),
  );
  const r = findAuthEscapeButton({ xml });
  assert.equal(r, null);
});

// ── Specificity & priority ─────────────────────────────────────────────

test("findAuthEscapeButton: prefers more-specific label over generic 'skip'", () => {
  // Both "Skip" and "Continue as guest" visible. Label list ordering puts
  // "continue as guest" first, so the finder must prefer it.
  const xml = wrap(
    node({ text: "Skip", clickable: true, bounds: "[900,80][1040,180]" }),
    node({ text: "Continue as guest", clickable: true, bounds: "[100,1600][980,1720]" }),
  );
  const r = findAuthEscapeButton({ xml });
  assert.ok(r);
  assert.equal(r.label, "Continue as guest");
});

// ── Case insensitivity & content-desc fallback ─────────────────────────

test("findAuthEscapeButton: matches case-insensitively", () => {
  const xml = wrap(node({ text: "SKIP FOR NOW", clickable: true, bounds: "[100,100][300,200]" }));
  const r = findAuthEscapeButton({ xml });
  assert.ok(r);
  assert.equal(r.label, "SKIP FOR NOW");
});

test("findAuthEscapeButton: matches content-desc when text is empty", () => {
  const xml = wrap(
    node({ text: "", desc: "Not now", clickable: true, bounds: "[100,100][300,200]" }),
  );
  const r = findAuthEscapeButton({ xml });
  assert.ok(r);
  assert.equal(r.label, "Not now");
});

// ── Ignore non-clickable text ──────────────────────────────────────────

test("findAuthEscapeButton: ignores non-clickable 'Skip' text (body copy)", () => {
  // App body might contain the word "skip" in copy — must not match
  const xml = wrap(
    node({ text: "You can skip this step later", clickable: false, bounds: "[0,400][1080,500]" }),
    node({ text: "Continue", clickable: true, bounds: "[80,700][1000,820]", cls: "android.widget.Button" }),
  );
  const r = findAuthEscapeButton({ xml });
  assert.equal(r, null);
});

// ── Degenerate inputs ──────────────────────────────────────────────────

test("findAuthEscapeButton: returns null on empty XML", () => {
  assert.equal(findAuthEscapeButton({ xml: "" }), null);
  assert.equal(findAuthEscapeButton({ xml: null }), null);
  assert.equal(findAuthEscapeButton({}), null);
  assert.equal(findAuthEscapeButton(null), null);
});

test("findAuthEscapeButton: ignores nodes with invalid bounds", () => {
  const xml = wrap(
    node({ text: "Skip", clickable: true, bounds: "invalid" }),
    node({ text: "", clickable: true, bounds: "[0,0][0,0]" }), // no label
  );
  const r = findAuthEscapeButton({ xml });
  assert.equal(r, null);
});

// ── Includes-match (button text has extra whitespace/padding) ───────────

test("findAuthEscapeButton: matches 'Skip ›' (label contains pattern)", () => {
  // Many apps render "Skip ›" or "Skip →" as the literal text
  const xml = wrap(node({ text: "Skip ›", clickable: true, bounds: "[900,100][1040,200]" }));
  const r = findAuthEscapeButton({ xml });
  assert.ok(r);
  assert.equal(r.label, "Skip ›");
});

// ── Perception-tier placeholder (tier 2 input shape) ───────────────────

test("findAuthEscapeButton: falls back to perception cache when XML has no match", () => {
  // When the button is custom-drawn (Compose, Canvas) and not in XML,
  // callers can pass a perception cache of {label, bounds} from a recent
  // vision pass. The finder searches those labels the same way.
  const xml = wrap(
    node({ text: "Welcome", clickable: false, bounds: "[0,200][1080,300]" }),
  );
  const perceptionCache = {
    buttons: [
      { label: "Continue as guest", bounds: { x1: 100, y1: 1600, x2: 980, y2: 1720 } },
      { label: "Sign in", bounds: { x1: 100, y1: 1400, x2: 980, y2: 1520 } },
    ],
  };
  const r = findAuthEscapeButton({ xml, perceptionCache });
  assert.ok(r);
  assert.equal(r.source, "perception");
  assert.equal(r.label, "Continue as guest");
  assert.equal(r.x, 540);
  assert.equal(r.y, 1660);
});

test("findAuthEscapeButton: prefers XML match over perception cache", () => {
  // If both sources have a match, XML wins — it's more reliable (pixel-perfect)
  const xml = wrap(node({ text: "Skip", clickable: true, bounds: "[900,80][1040,180]" }));
  const perceptionCache = {
    buttons: [{ label: "Continue as guest", bounds: { x1: 100, y1: 1600, x2: 980, y2: 1720 } }],
  };
  const r = findAuthEscapeButton({ xml, perceptionCache });
  assert.ok(r);
  assert.equal(r.source, "xml");
  assert.equal(r.label.toLowerCase(), "skip");
});
