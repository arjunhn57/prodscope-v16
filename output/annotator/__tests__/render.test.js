"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { renderAnnotated } = require("../render");
const { renderZoom } = require("../zoom");
const { buildFixture } = require("./fixtures/make-fixture");

// PNG magic bytes — every output should start with these.
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function annotationsFromFixture(fixture) {
  return {
    screenId: "screen_4",
    width: fixture.width,
    height: fixture.height,
    elements: fixture.elements,
    findings: [
      {
        screenId: "screen_4",
        finding: "Sign-in CTA dominates the fold before any value is delivered to first-time users.",
        severity: "concern",
        confidence: "observed",
        annotation: { mode: "element", elementIndex: 0, callout: "Above-the-fold" },
      },
      {
        screenId: "screen_4",
        finding: "Skip affordance is below platform 44dp tap-target guideline — friction for accessibility users.",
        severity: "watch_item",
        confidence: "observed",
        annotation: { mode: "element", elementIndex: 2, callout: "Tiny target" },
      },
    ],
  };
}

// ── renderAnnotated ───────────────────────────────────────────────────

test("renderAnnotated: returns a PNG buffer with the same dimensions as the source", async () => {
  const fixture = buildFixture();
  const r = await renderAnnotated({
    image: fixture.buffer,
    annotations: annotationsFromFixture(fixture),
  });
  assert.equal(r.ok, true);
  assert.equal(r.width, fixture.width);
  assert.equal(r.height, fixture.height);
  assert.ok(Buffer.isBuffer(r.buffer));
  assert.ok(r.buffer.length > fixture.buffer.length / 2, "rendered PNG should be non-trivially sized");
  // PNG magic bytes.
  assert.equal(r.buffer.slice(0, 8).compare(PNG_MAGIC), 0);
});

test("renderAnnotated: rejects unknown elementIndex via validator", async () => {
  const fixture = buildFixture();
  const a = annotationsFromFixture(fixture);
  a.findings[0].annotation.elementIndex = 99;
  const r = await renderAnnotated({ image: fixture.buffer, annotations: a });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes("elementIndex") && e.includes("out of range")));
});

test("renderAnnotated: rejects bad image input", async () => {
  const fixture = buildFixture();
  const r = await renderAnnotated({
    image: 12345, // not a path or buffer
    annotations: annotationsFromFixture(fixture),
  });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes("image must be a path or Buffer")));
});

test("renderAnnotated: handles whole_screen captions (caption strip drawn)", async () => {
  const fixture = buildFixture();
  const a = annotationsFromFixture(fixture);
  a.findings.push({
    screenId: "screen_4",
    finding: "Onboarding flow front-loads 12 lines of legal copy before the first interactive element.",
    severity: "watch_item",
    confidence: "inferred",
    annotation: { mode: "whole_screen", callout: "Legal copy heavy on first screen" },
  });
  const r = await renderAnnotated({ image: fixture.buffer, annotations: a });
  assert.equal(r.ok, true);
  // Output should be a valid PNG.
  assert.equal(r.buffer.slice(0, 8).compare(PNG_MAGIC), 0);
});

test("renderAnnotated: handles region mode with normalized bounds", async () => {
  const fixture = buildFixture();
  const a = annotationsFromFixture(fixture);
  a.findings = [
    {
      screenId: "screen_4",
      finding: "Tooltip overlay sits outside the classifier's clickable hierarchy at the top-right.",
      severity: "watch_item",
      confidence: "inferred",
      annotation: {
        mode: "region",
        bounds: { x1: 0.6, y1: 0.05, x2: 0.95, y2: 0.15 },
        justification: "Floating overlay rendered above the activity hierarchy and not classified.",
        callout: "Tooltip",
      },
    },
  ];
  const r = await renderAnnotated({ image: fixture.buffer, annotations: a });
  assert.equal(r.ok, true);
  assert.equal(r.buffer.slice(0, 8).compare(PNG_MAGIC), 0);
});

// ── renderZoom ────────────────────────────────────────────────────────

test("renderZoom: returns a 200% crop centered on the finding's bounds", async () => {
  const fixture = buildFixture();
  const a = annotationsFromFixture(fixture);
  const r = await renderZoom({
    image: fixture.buffer,
    annotations: a,
    findingIndex: 1, // the small "Skip" target
  });
  assert.equal(r.ok, true);
  assert.ok(Buffer.isBuffer(r.buffer));
  assert.equal(r.buffer.slice(0, 8).compare(PNG_MAGIC), 0);
  // Default zoom 2x — output should be larger than the bounds dimension.
  // Skip target is 140w x 40h + 32px padding both sides, x 2.0 zoom.
  // = (140 + 64) * 2 = 408w, (40 + 64) * 2 = 208h. Allow ±5px slop.
  assert.ok(r.width >= 400 && r.width <= 420);
  assert.ok(r.height >= 200 && r.height <= 220);
});

test("renderZoom: refuses whole_screen mode (no bounds to center on)", async () => {
  const fixture = buildFixture();
  const a = annotationsFromFixture(fixture);
  a.findings.push({
    screenId: "screen_4",
    finding: "Whole-flow finding spanning the full session.",
    severity: "watch_item",
    confidence: "inferred",
    annotation: { mode: "whole_screen", callout: "Flow-level" },
  });
  const r = await renderZoom({
    image: fixture.buffer,
    annotations: a,
    findingIndex: a.findings.length - 1,
  });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes("whole_screen")));
});

test("renderZoom: refuses out-of-range findingIndex", async () => {
  const fixture = buildFixture();
  const a = annotationsFromFixture(fixture);
  const r = await renderZoom({ image: fixture.buffer, annotations: a, findingIndex: 99 });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes("findingIndex")));
});

test("renderZoom: respects a custom zoomFactor", async () => {
  const fixture = buildFixture();
  const a = annotationsFromFixture(fixture);
  const r = await renderZoom({
    image: fixture.buffer,
    annotations: a,
    findingIndex: 0, // big "Sign in" element (320 x 64)
    zoomFactor: 1.5,
    padding: 0,
  });
  assert.equal(r.ok, true);
  // 320 * 1.5 = 480 wide; 64 * 1.5 = 96 tall. Allow small slop for rounding.
  assert.ok(Math.abs(r.width - 480) <= 2, `unexpected zoom width ${r.width}`);
  assert.ok(Math.abs(r.height - 96) <= 2, `unexpected zoom height ${r.height}`);
});
