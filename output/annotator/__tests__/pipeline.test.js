"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  citedScreenIdsFromReport,
  findingsForScreen,
  elementsFromClickables,
  readPngDimensions,
  annotateScreen,
  annotateCitedScreens,
} = require("../pipeline");
const { ANNOTATION_TOOL } = require("../tool");
const { buildFixture } = require("./fixtures/make-fixture");

// ── citedScreenIdsFromReport ──────────────────────────────────────────

test("citedScreenIdsFromReport: collects ids across verdict/flags/bugs/issues", () => {
  const report = {
    verdict: {
      claims: [
        { evidence_screen_ids: ["screen_1", "screen_4"] },
        { evidence_screen_ids: ["screen_4"] },
      ],
    },
    diligence_flags: [
      { evidence_screen_ids: ["screen_9"] },
    ],
    critical_bugs: [
      { evidence_screen_ids: ["screen_12"] },
    ],
    ux_issues: [
      { evidence_screen_ids: ["screen_4", "screen_18"] },
    ],
  };
  const ids = citedScreenIdsFromReport(report);
  // 5 unique: screen_1, screen_4, screen_9, screen_12, screen_18.
  assert.equal(ids.size, 5);
  assert.ok(ids.has("screen_1"));
  assert.ok(ids.has("screen_4"));
  assert.ok(ids.has("screen_9"));
  assert.ok(ids.has("screen_12"));
  assert.ok(ids.has("screen_18"));
});

test("citedScreenIdsFromReport: rejects bogus ids that don't match the regex", () => {
  const report = {
    verdict: { claims: [{ evidence_screen_ids: ["screen_4", "auth_login", 42, null, "screen_X"] }] },
    diligence_flags: [],
  };
  const ids = citedScreenIdsFromReport(report);
  assert.equal(ids.size, 1);
  assert.ok(ids.has("screen_4"));
});

test("citedScreenIdsFromReport: handles missing/null report safely", () => {
  assert.equal(citedScreenIdsFromReport(null).size, 0);
  assert.equal(citedScreenIdsFromReport({}).size, 0);
});

// ── findingsForScreen ─────────────────────────────────────────────────

test("findingsForScreen: pulls Stage 2 findings for the matching step", () => {
  const stage2 = [
    {
      step: 4,
      ux_issues: [{ severity: "concern", title: "Tap target", evidence: "Below 44dp" }],
    },
    {
      step: 9,
      critical_bugs: [{ severity: "critical", title: "Crash" }],
    },
  ];
  const out = findingsForScreen("screen_4", stage2, null);
  assert.equal(out.length, 1);
  assert.equal(out[0].kind, "ux");
});

test("findingsForScreen: pulls V2 findings citing the screen", () => {
  const report = {
    diligence_flags: [
      {
        severity: "concern",
        claim: "Pre-auth gating depresses D1.",
        evidence_screen_ids: ["screen_4", "screen_7"],
      },
    ],
    ux_issues: [
      {
        severity: "medium",
        claim: "OTP rejects clipboard paste.",
        evidence_screen_ids: ["screen_4"],
      },
    ],
  };
  const out = findingsForScreen("screen_4", [], report);
  assert.equal(out.length, 2);
  // Order matches the impl's pull sequence: critical_bugs -> ux -> diligence.
  assert.equal(out[0].kind, "ux");
  assert.equal(out[1].kind, "diligence");
});

test("findingsForScreen: caps at 8 to bound annotation cost per screen", () => {
  const stage2 = [{
    step: 4,
    ux_issues: Array.from({ length: 20 }, (_, i) => ({
      severity: "watch_item",
      title: `Issue ${i}`,
      evidence: `Evidence ${i}`,
    })),
  }];
  const out = findingsForScreen("screen_4", stage2, null);
  assert.equal(out.length, 8);
});

// ── elementsFromClickables ────────────────────────────────────────────

test("elementsFromClickables: converts {x1,y1,x2,y2} to [x1,y1,x2,y2] + label", () => {
  const raw = [
    { bounds: { x1: 40, y1: 120, x2: 360, y2: 184 }, label: "Sign in" },
    { bounds: { x1: 130, y1: 700, x2: 270, y2: 740 }, label: "Skip" },
  ];
  const out = elementsFromClickables(raw);
  assert.equal(out.length, 2);
  assert.deepEqual(out[0].bounds, [40, 120, 360, 184]);
  assert.equal(out[0].label, "Sign in");
  assert.deepEqual(out[1].bounds, [130, 700, 270, 740]);
});

test("elementsFromClickables: drops zero-area / inverted bounds", () => {
  const raw = [
    { bounds: { x1: 10, y1: 10, x2: 10, y2: 10 }, label: "Zero" },           // zero
    { bounds: { x1: 50, y1: 50, x2: 30, y2: 30 }, label: "Inverted" },       // inverted
    { bounds: { x1: 0, y1: 0, x2: 100, y2: 100 }, label: "Good" },            // ok
    { bounds: { x1: NaN, y1: 0, x2: 100, y2: 100 }, label: "NaN" },           // bad
    null,                                                                        // null
  ];
  const out = elementsFromClickables(raw);
  assert.equal(out.length, 1);
  assert.equal(out[0].label, "Good");
});

test("elementsFromClickables: tolerates missing input array", () => {
  assert.deepEqual(elementsFromClickables(undefined), []);
  assert.deepEqual(elementsFromClickables(null), []);
});

// ── readPngDimensions ─────────────────────────────────────────────────

test("readPngDimensions: reads width + height from a real PNG", () => {
  const fixture = buildFixture();
  const tmp = path.join(os.tmpdir(), `pipeline-png-${Date.now()}.png`);
  fs.writeFileSync(tmp, fixture.buffer);
  try {
    const dims = readPngDimensions(tmp);
    assert.deepEqual(dims, { width: fixture.width, height: fixture.height });
  } finally {
    fs.unlinkSync(tmp);
  }
});

test("readPngDimensions: returns null for non-PNG / missing file", () => {
  assert.equal(readPngDimensions("/no/such/file.png"), null);

  const tmp = path.join(os.tmpdir(), `pipeline-junk-${Date.now()}.bin`);
  fs.writeFileSync(tmp, Buffer.from("not a png"));
  try {
    assert.equal(readPngDimensions(tmp), null);
  } finally {
    fs.unlinkSync(tmp);
  }
});

// ── annotateScreen end-to-end ─────────────────────────────────────────

function makeMockClient(toolInputToReturn) {
  return {
    messages: {
      create: async () => ({
        content: [{ type: "tool_use", name: ANNOTATION_TOOL.name, input: toolInputToReturn }],
        usage: { input_tokens: 1000, output_tokens: 300 },
        stop_reason: "tool_use",
      }),
    },
  };
}

function buildScreenFromFixture(fixture, step, tmpDir) {
  const pngPath = path.join(tmpDir, `screen-${step}.png`);
  fs.writeFileSync(pngPath, fixture.buffer);
  // Synthetic XML matching the fixture's three "buttons" with bounds.
  const nodes = fixture.elements
    .map((e) => {
      const [x1, y1, x2, y2] = e.bounds;
      return `<node clickable="true" text="${e.label}" bounds="[${x1},${y1}][${x2},${y2}]" />`;
    })
    .join("\n");
  const xml = `<?xml version="1.0"?><hierarchy>${nodes}</hierarchy>`;
  return { path: pngPath, xml, index: step };
}

test("annotateScreen: end-to-end persists annotations.json + annotated.png", async () => {
  const fixture = buildFixture();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "annotator-pipeline-"));
  try {
    const screen = buildScreenFromFixture(fixture, 4, tmpDir);
    const findings = [
      { kind: "ux", severity: "concern", title: "Above fold", evidence: "Sign-in CTA dominates the fold." },
    ];

    const toolReturn = {
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
          annotation: { mode: "element", elementIndex: 0, callout: "Above the fold" },
        },
      ],
    };

    const r = await annotateScreen({
      screenId: "screen_4",
      screen,
      findings,
      outDir: path.join(tmpDir, "annotated"),
      deps: { client: makeMockClient(toolReturn) },
    });
    assert.equal(r.ok, true);
    assert.ok(fs.existsSync(r.files.json));
    assert.ok(fs.existsSync(r.files.png));
    const persisted = JSON.parse(fs.readFileSync(r.files.json, "utf-8"));
    assert.equal(persisted.findings.length, 1);
    assert.equal(persisted.findings[0].annotation.mode, "element");
    // PNG has the magic bytes.
    const head = fs.readFileSync(r.files.png).slice(0, 8);
    assert.equal(head[0], 0x89);
    assert.equal(head[1], 0x50);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("annotateScreen: bubbles up validation failures (out-of-range elementIndex)", async () => {
  const fixture = buildFixture();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "annotator-pipeline-"));
  try {
    const screen = buildScreenFromFixture(fixture, 4, tmpDir);
    const findings = [{ kind: "ux", severity: "concern", title: "X", evidence: "Y" }];

    const bad = {
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
          annotation: { mode: "element", elementIndex: 99, callout: "X" },
        },
      ],
    };

    const r = await annotateScreen({
      screenId: "screen_4",
      screen,
      findings,
      outDir: path.join(tmpDir, "annotated"),
      deps: { client: makeMockClient(bad) },
    });
    assert.equal(r.ok, false);
    assert.ok(r.errors.some((e) => e.includes("elementIndex") && e.includes("out of range")));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// ── annotateCitedScreens orchestration ────────────────────────────────

test("annotateCitedScreens: only runs on screens cited by the report", async () => {
  const fixture = buildFixture();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "annotator-pipeline-"));
  try {
    const screens = [
      buildScreenFromFixture(fixture, 4, tmpDir),
      buildScreenFromFixture(fixture, 9, tmpDir),
      buildScreenFromFixture(fixture, 12, tmpDir), // present but uncited
    ];
    const stage2Analyses = [
      {
        step: 4,
        ux_issues: [{ severity: "concern", title: "OTP", evidence: "OTP rejects paste." }],
      },
      {
        step: 9,
        ux_issues: [{ severity: "watch_item", title: "Skip", evidence: "Skip target is below 44dp." }],
      },
      // step 12 has no findings but is in the trace
    ];
    const report = {
      verdict: { claims: [{ evidence_screen_ids: ["screen_4"] }, { evidence_screen_ids: ["screen_9"] }, { evidence_screen_ids: ["screen_4"] }] },
      diligence_flags: [],
    };

    let callCount = 0;
    const toolReturn = (screenId) => ({
      screenId,
      width: fixture.width,
      height: fixture.height,
      elements: fixture.elements,
      findings: [
        {
          screenId,
          finding: "Sign-in CTA dominates the fold before any value is delivered to first-time users.",
          severity: "concern",
          confidence: "observed",
          annotation: { mode: "element", elementIndex: 0, callout: "Above fold" },
        },
      ],
    });

    const client = {
      messages: {
        create: async (req) => {
          callCount += 1;
          // Pull the screenId from the prompt text — the prompt builder
          // embeds it. Bash-fragile but ok in test.
          const userContent = req.messages[0].content;
          const text = (userContent.find((b) => b.type === "text") || {}).text || "";
          const m = text.match(/screenId:\s*(screen_\d+)/);
          const screenId = m ? m[1] : "screen_unknown";
          return {
            content: [{ type: "tool_use", name: ANNOTATION_TOOL.name, input: toolReturn(screenId) }],
            usage: { input_tokens: 1000, output_tokens: 300 },
            stop_reason: "tool_use",
          };
        },
      },
    };

    const out = await annotateCitedScreens({
      jobId: "job_test",
      report,
      screens,
      stage2Analyses,
      outDir: path.join(tmpDir, "annotated"),
      deps: { client },
    });

    // 2 cited screens (screen_4, screen_9) — model called twice. screen_12
    // present in trace but not cited; model not called.
    assert.equal(callCount, 2);
    assert.equal(out.annotatedScreens.length, 2);
    assert.ok(out.annotatedScreens.includes("screen_4"));
    assert.ok(out.annotatedScreens.includes("screen_9"));
    assert.ok(!out.annotatedScreens.includes("screen_12"));
    assert.equal(out.tokenUsage.input_tokens, 2000);
    assert.equal(out.tokenUsage.output_tokens, 600);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("annotateCitedScreens: tolerates cited-screen-not-in-trace gracefully", async () => {
  const fixture = buildFixture();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "annotator-pipeline-"));
  try {
    const screens = [buildScreenFromFixture(fixture, 4, tmpDir)];
    const report = {
      verdict: { claims: [{ evidence_screen_ids: ["screen_999"] }] },
      diligence_flags: [],
    };
    const out = await annotateCitedScreens({
      jobId: "job_test",
      report,
      screens,
      stage2Analyses: [],
      outDir: path.join(tmpDir, "annotated"),
      deps: {
        client: {
          messages: {
            create: async () => {
              throw new Error("should not be called");
            },
          },
        },
      },
    });
    assert.equal(out.annotatedScreens.length, 0);
    assert.equal(out.failedScreens.length, 1);
    assert.equal(out.failedScreens[0], "screen_999");
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
