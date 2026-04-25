"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  EvidencedClaimSchema,
  EvidencedFindingSchema,
  DiligenceFlagSchema,
  VerdictSchema,
  ReportV2Schema,
  validateReportV2,
} = require("../report-schemas");

// ── EvidencedClaim ─────────────────────────────────────────────────────

test("EvidencedClaim: accepts a valid claim with screen evidence", () => {
  const r = EvidencedClaimSchema.safeParse({
    claim: "The app gates browsing behind sign-in on screen_4 before any feed loads.",
    confidence: "observed",
    evidence_screen_ids: ["screen_4"],
  });
  assert.equal(r.success, true);
});

test("EvidencedClaim: rejects empty evidence array", () => {
  const r = EvidencedClaimSchema.safeParse({
    claim: "The app gates browsing behind sign-in before any feed loads.",
    confidence: "observed",
    evidence_screen_ids: [],
  });
  assert.equal(r.success, false);
});

test("EvidencedClaim: rejects too-short claim (< 20 chars)", () => {
  const r = EvidencedClaimSchema.safeParse({
    claim: "looks fine",
    confidence: "observed",
    evidence_screen_ids: ["screen_4"],
  });
  assert.equal(r.success, false);
});

test("EvidencedClaim: rejects invalid confidence value", () => {
  const r = EvidencedClaimSchema.safeParse({
    claim: "The app gates browsing behind sign-in on screen_4 before any feed loads.",
    confidence: "very_sure",
    evidence_screen_ids: ["screen_4"],
  });
  assert.equal(r.success, false);
});

// ── DiligenceFlag ──────────────────────────────────────────────────────

test("DiligenceFlag: requires founder_question with min 15 chars", () => {
  const r = DiligenceFlagSchema.safeParse({
    severity: "concern",
    claim: "Auth gates basic browsing before delivering value to first-time users.",
    confidence: "observed",
    evidence_screen_ids: ["screen_4", "screen_7"],
    founder_question: "Why?",
  });
  assert.equal(r.success, false);
});

test("DiligenceFlag: accepts a complete flag", () => {
  const r = DiligenceFlagSchema.safeParse({
    severity: "concern",
    claim: "Auth gates basic browsing before delivering value to first-time users.",
    confidence: "observed",
    evidence_screen_ids: ["screen_4", "screen_7"],
    severity_rationale: "Pre-account-creation gating typically suppresses D1 retention.",
    founder_question: "What's your D1 retention split between authenticated and unauthenticated cohorts?",
  });
  assert.equal(r.success, true);
});

// ── Verdict ────────────────────────────────────────────────────────────

test("Verdict: requires exactly 3 claims", () => {
  const baseClaim = {
    claim: "The app gates browsing behind sign-in before any feed loads on screen_4.",
    confidence: "observed",
    evidence_screen_ids: ["screen_4"],
  };
  assert.equal(
    VerdictSchema.safeParse({ claims: [baseClaim, baseClaim] }).success,
    false,
    "2 claims should fail",
  );
  assert.equal(
    VerdictSchema.safeParse({ claims: [baseClaim, baseClaim, baseClaim] }).success,
    true,
    "3 claims should succeed",
  );
  assert.equal(
    VerdictSchema.safeParse({ claims: [baseClaim, baseClaim, baseClaim, baseClaim] }).success,
    false,
    "4 claims should fail",
  );
});

// ── EvidencedFinding ───────────────────────────────────────────────────

test("EvidencedFinding: requires title + claim + severity + evidence", () => {
  const valid = {
    title: "OTP screen does not paste from clipboard",
    claim: "Tested on screen_9: long-press did not surface a paste affordance.",
    severity: "medium",
    confidence: "observed",
    evidence_screen_ids: ["screen_9"],
  };
  assert.equal(EvidencedFindingSchema.safeParse(valid).success, true);

  // Missing severity
  const noSev = { ...valid };
  delete noSev.severity;
  assert.equal(EvidencedFindingSchema.safeParse(noSev).success, false);

  // Empty evidence
  assert.equal(
    EvidencedFindingSchema.safeParse({ ...valid, evidence_screen_ids: [] }).success,
    false,
  );
});

// ── ReportV2 + cross-field validator ───────────────────────────────────

function validClaim(ids = ["screen_1"]) {
  return {
    claim: "The app surfaces a sign-in modal on the first hub interaction at screen_1.",
    confidence: "observed",
    evidence_screen_ids: ids,
  };
}

function validFlag(ids = ["screen_1"]) {
  return {
    severity: "concern",
    claim: "Sign-in is required before any meaningful content is shown to the user.",
    confidence: "observed",
    evidence_screen_ids: ids,
    founder_question: "Why gate browsing before account creation? Have you measured D1 impact?",
  };
}

test("validateReportV2: accepts a fully-valid report", () => {
  const validIds = new Set(["screen_1", "screen_4", "screen_9"]);
  const input = {
    verdict: { claims: [validClaim(["screen_1"]), validClaim(["screen_4"]), validClaim(["screen_9"])] },
    diligence_flags: [validFlag(["screen_1", "screen_4"])],
    coverage_summary: { screens_reached: 30, screens_attempted_blocked: [], areas_not_attempted: [] },
  };
  const r = validateReportV2(input, validIds);
  assert.equal(r.ok, true);
});

test("validateReportV2: rejects report citing unknown screen ids", () => {
  const validIds = new Set(["screen_1", "screen_4"]);
  const input = {
    verdict: {
      claims: [
        validClaim(["screen_1"]),
        validClaim(["screen_4"]),
        validClaim(["screen_FAKE"]), // <- hallucinated id
      ],
    },
    diligence_flags: [validFlag(["screen_1"])],
    coverage_summary: { screens_reached: 30 },
  };
  const r = validateReportV2(input, validIds);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes("unknown screen id")));
  assert.ok(r.errors.some((e) => e.includes("screen_FAKE")));
});

test("validateReportV2: catches structural issues even before id check", () => {
  const validIds = new Set(["screen_1"]);
  const input = {
    verdict: { claims: [validClaim(["screen_1"]), validClaim(["screen_1"])] }, // only 2 claims
    diligence_flags: [validFlag(["screen_1"])],
    coverage_summary: { screens_reached: 5 },
  };
  const r = validateReportV2(input, validIds);
  assert.equal(r.ok, false);
});

test("validateReportV2: rejects missing diligence_flags array", () => {
  const validIds = new Set(["screen_1"]);
  const input = {
    verdict: { claims: [validClaim(), validClaim(), validClaim()] },
    coverage_summary: { screens_reached: 5 },
  };
  const r = validateReportV2(input, validIds);
  assert.equal(r.ok, false);
});

test("validateReportV2: rejects diligence_flags with > 5 items", () => {
  const validIds = new Set(["screen_1"]);
  const input = {
    verdict: { claims: [validClaim(), validClaim(), validClaim()] },
    diligence_flags: [validFlag(), validFlag(), validFlag(), validFlag(), validFlag(), validFlag()],
    coverage_summary: { screens_reached: 5 },
  };
  const r = validateReportV2(input, validIds);
  assert.equal(r.ok, false);
});

test("validateReportV2: critical_bugs with hallucinated screen id rejected", () => {
  const validIds = new Set(["screen_1", "screen_2"]);
  const input = {
    verdict: { claims: [validClaim(["screen_1"]), validClaim(["screen_2"]), validClaim(["screen_1"])] },
    diligence_flags: [validFlag(["screen_1"])],
    critical_bugs: [
      {
        title: "App crashed on resume",
        claim: "The app terminated unexpectedly when foregrounded after a backgrounded state on screen_99.",
        severity: "critical",
        confidence: "observed",
        evidence_screen_ids: ["screen_99"], // <- not in validIds
      },
    ],
    coverage_summary: { screens_reached: 5 },
  };
  const r = validateReportV2(input, validIds);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes("screen_99")));
});
