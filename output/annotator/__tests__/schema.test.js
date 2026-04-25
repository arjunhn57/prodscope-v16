"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  validateScreenAnnotations,
  ScreenAnnotationsSchema,
  ElementAnnotationSchema,
  RegionAnnotationSchema,
  WholeScreenAnnotationSchema,
} = require("../schema");

// ── Discriminated union per-mode shape tests ──────────────────────────

test("ElementAnnotation: requires elementIndex (int >= 0) + callout", () => {
  assert.equal(
    ElementAnnotationSchema.safeParse({
      mode: "element",
      elementIndex: 0,
      callout: "Tap target",
    }).success,
    true,
  );
  assert.equal(
    ElementAnnotationSchema.safeParse({
      mode: "element",
      elementIndex: -1,
      callout: "Bad",
    }).success,
    false,
  );
  assert.equal(
    ElementAnnotationSchema.safeParse({
      mode: "element",
      elementIndex: 0,
      callout: "",
    }).success,
    false,
  );
});

test("RegionAnnotation: requires bounds with positive area + justification (>=20 chars)", () => {
  // Valid.
  assert.equal(
    RegionAnnotationSchema.safeParse({
      mode: "region",
      bounds: { x1: 0.1, y1: 0.1, x2: 0.4, y2: 0.4 },
      justification: "No classified element fits this floating banner.",
      callout: "Banner",
    }).success,
    true,
  );
  // Justification too short — defends against lazy synthesizer defaults.
  assert.equal(
    RegionAnnotationSchema.safeParse({
      mode: "region",
      bounds: { x1: 0.1, y1: 0.1, x2: 0.4, y2: 0.4 },
      justification: "no element",
      callout: "X",
    }).success,
    false,
  );
  // Inverted bounds.
  assert.equal(
    RegionAnnotationSchema.safeParse({
      mode: "region",
      bounds: { x1: 0.4, y1: 0.4, x2: 0.1, y2: 0.1 },
      justification: "Some adequately long defensible justification text here.",
      callout: "X",
    }).success,
    false,
  );
});

test("WholeScreenAnnotation: just a callout, no bounds", () => {
  assert.equal(
    WholeScreenAnnotationSchema.safeParse({
      mode: "whole_screen",
      callout: "Onboarding feels rushed across screens 1-4 — flow-level finding",
    }).success,
    true,
  );
});

// ── Top-level ScreenAnnotations ───────────────────────────────────────

test("ScreenAnnotations: rejects screenId not matching screen_<step>", () => {
  const r = ScreenAnnotationsSchema.safeParse({
    screenId: "auth_login",
    width: 400,
    height: 800,
    elements: [],
    findings: [
      {
        screenId: "screen_4",
        finding: "Login screen has tiny tap target on 'Skip'.",
        severity: "watch_item",
        confidence: "observed",
        annotation: { mode: "whole_screen", callout: "X" },
      },
    ],
  });
  assert.equal(r.success, false);
});

test("ScreenAnnotations: rejects findings array with > 8 items", () => {
  const finding = {
    screenId: "screen_4",
    finding: "Tiny tap target on the 'Skip' affordance at the bottom.",
    severity: "watch_item",
    confidence: "observed",
    annotation: { mode: "whole_screen", callout: "x" },
  };
  const r = ScreenAnnotationsSchema.safeParse({
    screenId: "screen_4",
    width: 400,
    height: 800,
    elements: [],
    findings: Array.from({ length: 9 }, () => finding),
  });
  assert.equal(r.success, false);
});

// ── validateScreenAnnotations cross-check ─────────────────────────────

test("validateScreenAnnotations: rejects mode=element with elementIndex out of range", () => {
  const input = {
    screenId: "screen_4",
    width: 400,
    height: 800,
    elements: [
      { bounds: [40, 120, 360, 184], label: "Sign in" },
    ],
    findings: [
      {
        screenId: "screen_4",
        finding: "OTP field rejects clipboard paste — friction on same-device flow.",
        severity: "concern",
        confidence: "observed",
        annotation: { mode: "element", elementIndex: 5, callout: "OTP" },
      },
    ],
  };
  const r = validateScreenAnnotations(input);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes("elementIndex") && e.includes("out of range")));
});

test("validateScreenAnnotations: accepts a fully-valid annotation set", () => {
  const input = {
    screenId: "screen_4",
    width: 400,
    height: 800,
    elements: [
      { bounds: [40, 120, 360, 184], label: "Sign in" },
      { bounds: [130, 700, 270, 740], label: "Skip" },
    ],
    findings: [
      {
        screenId: "screen_4",
        finding: "Sign in button dominates the fold — pre-account gating shown immediately.",
        severity: "concern",
        confidence: "observed",
        annotation: { mode: "element", elementIndex: 0, callout: "Sign-in dominant" },
      },
      {
        screenId: "screen_4",
        finding: "Skip target is below 44dp — fails platform tap-target guidelines.",
        severity: "watch_item",
        confidence: "observed",
        annotation: { mode: "element", elementIndex: 1, callout: "Tiny target" },
      },
    ],
  };
  const r = validateScreenAnnotations(input);
  assert.equal(r.ok, true);
  assert.equal(r.annotations.findings.length, 2);
});

test("validateScreenAnnotations: mixed element + region + whole_screen all pass", () => {
  const input = {
    screenId: "screen_4",
    width: 400,
    height: 800,
    elements: [{ bounds: [40, 120, 360, 184], label: "Sign in" }],
    findings: [
      {
        screenId: "screen_4",
        finding: "Sign in CTA dominates the fold before any value is delivered to the user.",
        severity: "concern",
        confidence: "observed",
        annotation: { mode: "element", elementIndex: 0, callout: "Above fold" },
      },
      {
        screenId: "screen_4",
        finding: "Floating tooltip near top-right has no classified bounds — region mode required.",
        severity: "watch_item",
        confidence: "inferred",
        annotation: {
          mode: "region",
          bounds: { x1: 0.6, y1: 0.05, x2: 0.95, y2: 0.15 },
          justification: "Tooltip overlay is rendered outside the classifier's clickable hierarchy.",
          callout: "Tooltip",
        },
      },
      {
        screenId: "screen_4",
        finding: "Overall onboarding sequence is heavy on legal copy compared to category norm.",
        severity: "watch_item",
        confidence: "inferred",
        annotation: { mode: "whole_screen", callout: "Legal-copy heavy" },
      },
    ],
  };
  const r = validateScreenAnnotations(input);
  assert.equal(r.ok, true);
});
