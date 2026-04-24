"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { resolveTapTarget } = require("../tap-target-resolver");

// ── XML fixture helpers ────────────────────────────────────────────────

function wrap(...innerNodes) {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<hierarchy rotation="0">\n${innerNodes.join("\n")}\n</hierarchy>`;
}

function node({ text = "", desc = "", clickable = true, bounds = "[0,0][0,0]", cls = "android.widget.Button" }) {
  return `<node index="0" text="${text}" resource-id="" class="${cls}" package="com.example" content-desc="${desc}" checkable="false" checked="false" clickable="${clickable}" enabled="true" focusable="true" focused="false" scrollable="false" long-clickable="false" password="false" selected="false" bounds="${bounds}" />`;
}

// Biztoso-style login screen: "Continue with Email" far below the model's guess.
const biztosoLoginXml = wrap(
  node({ text: "Biztoso", clickable: false, bounds: "[200,400][880,560]" }),
  node({ text: "Phone Next", clickable: true, bounds: "[40,900][1040,1100]" }),
  node({ text: "Continue with Email", clickable: true, bounds: "[40,1640][1040,1790]" }),
  node({ text: "Sign in with Google", clickable: true, bounds: "[40,1850][1040,2000]" }),
);

// ── 1. exact match ────────────────────────────────────────────────────

test("resolveTapTarget: exact match returns XML center with confidence 'exact'", () => {
  const r = resolveTapTarget(biztosoLoginXml, "Continue with Email", { x: 352, y: 1006 });
  assert.equal(r.source, "xml");
  assert.equal(r.confidence, "exact");
  assert.equal(r.x, 540); // (40+1040)/2
  assert.equal(r.y, 1715); // (1640+1790)/2
});

// ── 2. case-insensitive match ─────────────────────────────────────────

test("resolveTapTarget: case-insensitive match returns confidence 'ci'", () => {
  const r = resolveTapTarget(biztosoLoginXml, "continue with email", { x: 352, y: 1006 });
  assert.equal(r.source, "xml");
  assert.equal(r.confidence, "ci");
  assert.equal(r.x, 540);
  assert.equal(r.y, 1715);
});

// ── 3. substring match ────────────────────────────────────────────────

test("resolveTapTarget: substring match returns confidence 'substring'", () => {
  const r = resolveTapTarget(biztosoLoginXml, "Continue with Ema", { x: 352, y: 1006 });
  assert.equal(r.source, "xml");
  assert.equal(r.confidence, "substring");
  assert.equal(r.x, 540);
  assert.equal(r.y, 1715);
});

// ── 4. no match falls back to vision coords ──────────────────────────

test("resolveTapTarget: no matching label falls back to vision coords", () => {
  const r = resolveTapTarget(biztosoLoginXml, "Enroll via Bluetooth", { x: 352, y: 1006 });
  assert.equal(r.source, "vision");
  assert.equal(r.confidence, "none");
  assert.equal(r.x, 352);
  assert.equal(r.y, 1006);
});

// ── 5. empty / missing XML returns vision fallback verbatim ──────────

test("resolveTapTarget: empty XML returns fallback verbatim", () => {
  const r = resolveTapTarget("", "Continue with Email", { x: 100, y: 200 });
  assert.equal(r.source, "vision");
  assert.equal(r.x, 100);
  assert.equal(r.y, 200);
});

test("resolveTapTarget: null XML returns fallback verbatim without throwing", () => {
  assert.doesNotThrow(() => resolveTapTarget(null, "Continue with Email", { x: 50, y: 60 }));
  const r = resolveTapTarget(null, "Continue with Email", { x: 50, y: 60 });
  assert.equal(r.source, "vision");
  assert.equal(r.x, 50);
  assert.equal(r.y, 60);
});

test("resolveTapTarget: missing targetText returns fallback", () => {
  const r = resolveTapTarget(biztosoLoginXml, "", { x: 111, y: 222 });
  assert.equal(r.source, "vision");
  assert.equal(r.x, 111);
  assert.equal(r.y, 222);
});

// ── Tiebreak by proximity ─────────────────────────────────────────────

test("resolveTapTarget: multiple exact matches — tiebreak by proximity to fallback", () => {
  const xml = wrap(
    node({ text: "Continue", clickable: true, bounds: "[0,100][200,200]" }),
    node({ text: "Continue", clickable: true, bounds: "[0,1600][200,1700]" }),
  );
  // Fallback near the top match.
  const rTop = resolveTapTarget(xml, "Continue", { x: 100, y: 150 });
  assert.equal(rTop.y, 150); // center of [0,100][200,200]
  // Fallback near the bottom match.
  const rBot = resolveTapTarget(xml, "Continue", { x: 100, y: 1650 });
  assert.equal(rBot.y, 1650); // center of [0,1600][200,1700]
});

// ── Invalid fallback does not crash ────────────────────────────────────

test("resolveTapTarget: non-numeric fallback coords coerce to 0", () => {
  const r = resolveTapTarget(biztosoLoginXml, "Enroll via Bluetooth", { x: NaN, y: "oops" });
  assert.equal(r.source, "vision");
  assert.equal(r.x, 0);
  assert.equal(r.y, 0);
});

// ── Compose parent-bounds-inheritance (real biztoso pattern) ─────────────
//
// In Jetpack Compose, a Button often renders as a clickable parent node with
// empty text/content-desc, plus a non-clickable TextView child that carries
// the actual label. extractClickableLabels must inherit the label from the
// descendant but return the clickable parent's bounds (that's where the tap
// must land). Without this, "Continue with Email" is invisible to the
// resolver and vision's wrong coord gets used, tapping the disabled Next
// button 700+ px away.
const biztosoComposeXml = `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?>
<hierarchy rotation="0">
<node index="12" text="" content-desc="" clickable="false" bounds="[42,1475][1038,1606]">
  <node index="0" text="" content-desc="" clickable="true" bounds="[42,1475][1038,1606]">
    <node index="0" text="Continue with Email" content-desc="" clickable="false" bounds="[384,1516][765,1565]" />
  </node>
</node>
<node index="13" text="" content-desc="" clickable="false" bounds="[42,1648][1038,1779]">
  <node index="0" text="" content-desc="" clickable="true" bounds="[42,1648][1038,1779]">
    <node index="0" text="" content-desc="" clickable="false" bounds="[260,1651][386,1777]" />
    <node index="1" text="Continue with Google" content-desc="" clickable="false" bounds="[367,1689][782,1738]" />
  </node>
</node>
</hierarchy>`;

test("resolveTapTarget: Compose parent-bounds — clickable parent with text child", () => {
  // Vision guessed ~(352, 1006) — the disabled Phone Next button. XML must
  // correctly pull the label from the child and return the parent's center
  // at (540, 1540) for "Continue with Email".
  const r = resolveTapTarget(biztosoComposeXml, "Continue with Email", { x: 352, y: 1006 });
  assert.equal(r.source, "xml");
  assert.equal(r.confidence, "exact");
  assert.equal(r.x, 540); // (42+1038)/2
  assert.equal(r.y, 1540); // (1475+1606)/2
});

test("resolveTapTarget: Compose parent-bounds — sibling text child is selected", () => {
  // "Continue with Google" lives alongside an unlabeled icon node inside the
  // clickable parent. Resolver picks the smallest labeled descendant.
  const r = resolveTapTarget(biztosoComposeXml, "Continue with Google", { x: 540, y: 1700 });
  assert.equal(r.source, "xml");
  assert.equal(r.confidence, "exact");
  assert.equal(r.x, 540); // (42+1038)/2
  assert.equal(r.y, 1713); // (1648+1779)/2
});
