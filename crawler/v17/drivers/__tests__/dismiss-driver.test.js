"use strict";

/**
 * Tests for v17/drivers/dismiss-driver.js.
 *
 * 6 cases per Phase B.3 plan:
 *   1. claim() → true on XML with BottomSheetDialog class.
 *   2. claim() → true on XML with a ✕ content-desc.
 *   3. claim() → false on a plain content screen with no modal hint.
 *   4. decide() returns null when classifier returns null (timeout).
 *   5. decide() taps the top-most (lowest cy) dismiss_button from classifier output.
 *   6. decide() returns null when classifier finds no dismiss_button (e.g. modal with only CTAs).
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const dismissDriver = require("../dismiss-driver");

// ── XML fixture helpers ─────────────────────────────────────────────────

function wrap(...nodes) {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<hierarchy rotation="0">\n${nodes.join("\n")}\n</hierarchy>`;
}

function node({
  text = "",
  desc = "",
  resourceId = "",
  cls = "android.widget.Button",
  pkg = "com.example",
  clickable = true,
  bounds = "[0,0][100,100]",
}) {
  return (
    `<node text="${text}" resource-id="${resourceId}" class="${cls}" ` +
    `package="${pkg}" content-desc="${desc}" clickable="${clickable}" ` +
    `bounds="${bounds}" />`
  );
}

// ── Mock classifier (mirrors the shape in auth-driver.test.js) ─────────

function makeClassifier(roleOf) {
  const calls = [];
  return {
    calls,
    fn: async (graph) => {
      calls.push({ count: graph.clickables.length });
      return graph.clickables.map((c, i) => {
        const role = roleOf(c, i) || "unknown";
        return { ...c, role, confidence: 0.95 };
      });
    },
  };
}

function makeNullClassifier() {
  const calls = [];
  return {
    calls,
    fn: async (graph) => {
      calls.push({ count: graph.clickables.length });
      return null; // simulates timeout / error path
    },
  };
}

// ── Fixtures ────────────────────────────────────────────────────────────

// LinkedIn-style "Add a photo" upsell in a BottomSheetDialog with footer Not Now.
const linkedinBottomSheetXml = wrap(
  node({
    cls: "com.google.android.material.bottomsheet.BottomSheetDialog",
    pkg: "com.linkedin.android",
    bounds: "[0,1200][1080,2100]",
    clickable: false,
  }),
  node({
    text: "Add photo",
    resourceId: "com.linkedin.android:id/cta_button",
    pkg: "com.linkedin.android",
    bounds: "[40,1850][1040,1970]",
  }),
  node({
    text: "Not now",
    resourceId: "com.linkedin.android:id/dismiss_button",
    pkg: "com.linkedin.android",
    bounds: "[40,1990][1040,2080]",
  }),
);

// Generic upsell with a ✕ close icon in top-right (no explicit modal class
// name — relies on the content-desc claim path).
const genericCloseIconXml = wrap(
  node({
    desc: "Close",
    resourceId: "com.generic.app:id/close",
    cls: "android.widget.ImageButton",
    pkg: "com.generic.app",
    bounds: "[950,40][1050,140]",
  }),
  node({
    text: "Upgrade to Pro",
    resourceId: "com.generic.app:id/upgrade_cta",
    pkg: "com.generic.app",
    bounds: "[40,1600][1040,1720]",
  }),
);

// Wikipedia article content — no modal hints, must NOT be claimed.
const wikipediaContentXml = wrap(
  node({
    text: "Android (operating system)",
    cls: "android.widget.TextView",
    pkg: "org.wikipedia",
    clickable: false,
    bounds: "[40,200][1040,300]",
  }),
  node({
    text: "Edit",
    resourceId: "org.wikipedia:id/edit_tab",
    pkg: "org.wikipedia",
    bounds: "[900,100][1040,180]",
  }),
);

// Modal with only CTAs — no dismiss option visible (user must interact).
const mandatoryModalXml = wrap(
  node({
    cls: "androidx.appcompat.app.AlertDialog",
    pkg: "com.bank.app",
    bounds: "[0,800][1080,1700]",
    clickable: false,
  }),
  node({
    text: "I agree",
    resourceId: "com.bank.app:id/agree_button",
    pkg: "com.bank.app",
    bounds: "[40,1500][1040,1620]",
  }),
);

// ── Tests ──────────────────────────────────────────────────────────────

test("DismissDriver.claim: true when XML has BottomSheetDialog class", () => {
  const ok = dismissDriver.claim({ xml: linkedinBottomSheetXml });
  assert.equal(ok, true);
});

test("DismissDriver.claim: true when XML has close content-desc", () => {
  const ok = dismissDriver.claim({ xml: genericCloseIconXml });
  assert.equal(ok, true);
});

test("DismissDriver.claim: false on plain content (no modal hints)", () => {
  const ok = dismissDriver.claim({ xml: wikipediaContentXml });
  assert.equal(ok, false);
});

test("DismissDriver.decide: returns null when classifier returns null (timeout path)", async () => {
  const { fn: classify } = makeNullClassifier();
  const action = await dismissDriver.decide(
    { xml: linkedinBottomSheetXml },
    {},
    { classify },
  );
  assert.equal(action, null);
});

test("DismissDriver.decide: taps the top-most dismiss_button from classifier output", async () => {
  // Two dismiss candidates: top-right close icon (cy=90) and footer "Not now" (cy~2035).
  // Driver must pick the top-right one.
  const xml = wrap(
    node({
      cls: "com.google.android.material.bottomsheet.BottomSheetDialog",
      pkg: "com.linkedin.android",
      bounds: "[0,0][1080,2100]",
      clickable: false,
    }),
    node({
      desc: "Close",
      resourceId: "com.linkedin.android:id/close_icon",
      cls: "android.widget.ImageButton",
      pkg: "com.linkedin.android",
      bounds: "[950,40][1050,140]", // cy = 90
    }),
    node({
      text: "Not now",
      resourceId: "com.linkedin.android:id/dismiss_footer",
      pkg: "com.linkedin.android",
      bounds: "[40,1990][1040,2080]", // cy = 2035
    }),
  );

  // Classifier tags both as dismiss_button (matching real Haiku behaviour on
  // modal with both a ✕ and a "Not now" text button).
  const { fn: classify } = makeClassifier((c) => {
    const id = c.resourceId || "";
    if (/close_icon|dismiss_footer/.test(id)) return "dismiss_button";
    return "unknown";
  });

  const action = await dismissDriver.decide({ xml }, {}, { classify });
  assert.ok(action, "should produce an action");
  assert.equal(action.type, "tap");
  assert.equal(action.y, 90, "must pick the top-most dismiss (the ✕ icon), not the footer");
});

test("DismissDriver.decide: returns null when classifier finds no dismiss_button", async () => {
  // Classifier tags only the "I agree" button — no dismiss option.
  const { fn: classify } = makeClassifier((c) => {
    if ((c.resourceId || "").includes("agree_button")) return "submit_button";
    return "unknown";
  });

  const action = await dismissDriver.decide(
    { xml: mandatoryModalXml },
    {},
    { classify },
  );
  assert.equal(action, null);
});
