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

// ── 2026-04-24: plain-text label claim (biztoso run b004fbdf regression) ────
//
// Upsell / reminder dialogs that ship as ordinary Buttons with a
// "Remind me later" / "Maybe later" / "Not now" label — no modal-class
// parent, no close-glyph, no matching resource-id. DismissDriver must
// still claim these so the downstream classifier + decide() can dismiss
// them deterministically. Before this fix the crawl fell through to
// LLMFallback and hit the press_back guardrail on step 4.

test("DismissDriver.claim: true on 'Remind me later' plain Button (biztoso-style)", () => {
  // No modal class, no close-glyph, no dismiss-y resource-id.
  const xml = wrap(
    node({
      text: "Upgrade to Premium",
      resourceId: "com.biztoso.app:id/cta_upgrade",
      pkg: "com.biztoso.app",
      bounds: "[40,1400][1040,1520]",
    }),
    node({
      text: "Remind me later",
      resourceId: "com.biztoso.app:id/reminder_snooze",
      pkg: "com.biztoso.app",
      cls: "android.widget.Button",
      bounds: "[40,1600][1040,1720]",
    }),
  );
  assert.equal(dismissDriver.claim({ xml }), true);
});

test("DismissDriver.claim: true on 'Not now' plain Button", () => {
  const xml = wrap(
    node({
      text: "Turn on notifications",
      resourceId: "com.app:id/cta",
      pkg: "com.app",
      bounds: "[40,1400][1040,1520]",
    }),
    node({
      text: "Not now",
      resourceId: "com.app:id/later_button",
      pkg: "com.app",
      bounds: "[40,1600][1040,1720]",
    }),
  );
  assert.equal(dismissDriver.claim({ xml }), true);
});

test("DismissDriver.claim: true on 'Skip for now' plain Button", () => {
  const xml = wrap(
    node({
      text: "Skip for now",
      pkg: "com.app",
      bounds: "[40,1600][1040,1720]",
    }),
  );
  assert.equal(dismissDriver.claim({ xml }), true);
});

test("DismissDriver.claim: true on 'No thanks' content-desc", () => {
  // Some apps put the dismiss label in content-desc for accessibility.
  const xml = wrap(
    node({
      desc: "No thanks",
      cls: "android.view.View",
      pkg: "com.app",
      bounds: "[40,1600][1040,1720]",
    }),
  );
  assert.equal(dismissDriver.claim({ xml }), true);
});

test("DismissDriver.claim: false on 'Skip navigation' accessibility label (not a dismiss CTA)", () => {
  // Accessibility labels like "Skip navigation" should NOT trigger claim —
  // the phrase isn't in our allowlist. Bare "skip" was intentionally
  // excluded from DISMISS_LABEL_REGEX for this reason.
  const xml = wrap(
    node({
      desc: "Skip navigation",
      cls: "android.widget.TextView",
      pkg: "org.wikipedia",
      clickable: false,
      bounds: "[0,0][100,40]",
    }),
    node({
      text: "Article title",
      pkg: "org.wikipedia",
      clickable: false,
      bounds: "[40,100][1040,200]",
    }),
  );
  assert.equal(dismissDriver.claim({ xml }), false);
});

test("DismissDriver.claim: false on auth screen with 'Cancel' button (cancel is NOT a dismiss CTA — login creds may be present)", () => {
  // Critical: DismissDriver runs BEFORE AuthDriver. If "Cancel" triggered
  // claim here, we'd back out of the login form even when the user
  // provided credentials. Cancel / Close are deliberately excluded from
  // DISMISS_LABEL_REGEX for this reason; they're only matched via the
  // stricter CLOSE_DESC_REGEX / CLOSE_ID_REGEX structural paths.
  const xml = wrap(
    node({
      text: "Password",
      cls: "android.widget.EditText",
      pkg: "com.example",
      bounds: "[40,800][1040,900]",
    }),
    node({
      text: "Cancel",
      cls: "android.widget.Button",
      pkg: "com.example",
      bounds: "[40,1600][520,1720]",
    }),
    node({
      text: "Sign in",
      cls: "android.widget.Button",
      pkg: "com.example",
      bounds: "[560,1600][1040,1720]",
    }),
  );
  assert.equal(dismissDriver.claim({ xml }), false);
});
