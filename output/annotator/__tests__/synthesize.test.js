"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  synthesizeAnnotations,
  loadImageForVision,
  extractToolInput,
} = require("../synthesize");
const { ANNOTATION_TOOL } = require("../tool");
const { buildFixture } = require("./fixtures/make-fixture");

// ── loadImageForVision ────────────────────────────────────────────────

test("loadImageForVision: accepts a Buffer and infers png from magic bytes", () => {
  const fixture = buildFixture();
  const r = loadImageForVision(fixture.buffer);
  assert.equal(r.mediaType, "image/png");
  assert.ok(typeof r.data === "string" && r.data.length > 0);
});

test("loadImageForVision: rejects missing path", () => {
  const r = loadImageForVision("/no/such/file/that/exists.png");
  assert.ok(r.error && r.error.includes("not found"));
});

test("loadImageForVision: reads from a real path", () => {
  const fixture = buildFixture();
  const tmp = path.join(os.tmpdir(), `annotator-test-${Date.now()}.png`);
  fs.writeFileSync(tmp, fixture.buffer);
  try {
    const r = loadImageForVision(tmp);
    assert.equal(r.mediaType, "image/png");
    assert.ok(r.data.length > 0);
  } finally {
    fs.unlinkSync(tmp);
  }
});

// ── extractToolInput ──────────────────────────────────────────────────

test("extractToolInput: returns null without matching tool block", () => {
  assert.equal(extractToolInput(null), null);
  assert.equal(
    extractToolInput({
      content: [{ type: "tool_use", name: "different_tool", input: { x: 1 } }],
    }),
    null,
  );
});

test("extractToolInput: returns the tool input when emit_annotations present", () => {
  const r = extractToolInput({
    content: [
      { type: "text", text: "ignored" },
      { type: "tool_use", name: ANNOTATION_TOOL.name, input: { findings: [] } },
    ],
  });
  assert.deepEqual(r, { findings: [] });
});

// ── End-to-end synthesizer with mocked client ─────────────────────────

function mockClient(toolInputToReturn, opts = {}) {
  return {
    messages: {
      create: async (req) => {
        if (opts.captureRequest) opts.captureRequest(req);
        if (opts.throwError) throw opts.throwError;
        if (opts.skipTool) {
          return {
            content: [{ type: "text", text: "I refuse." }],
            usage: { input_tokens: 100, output_tokens: 10 },
            stop_reason: "end_turn",
          };
        }
        return {
          content: [
            { type: "tool_use", name: ANNOTATION_TOOL.name, input: toolInputToReturn },
          ],
          usage: { input_tokens: 1200, output_tokens: 400 },
          stop_reason: "tool_use",
        };
      },
    },
  };
}

function fixtureFindings() {
  return [
    {
      kind: "ux",
      severity: "concern",
      title: "Pre-account auth gate",
      evidence: "Sign-in modal blocks the feed before any content is shown to the user.",
      confidence: 0.9,
    },
    {
      kind: "a11y",
      severity: "watch_item",
      title: "Tiny tap target",
      evidence: "Skip affordance is below the platform 44dp tap-target guideline.",
      confidence: 0.85,
    },
  ];
}

function validToolReturn(fixture) {
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
        annotation: { mode: "element", elementIndex: 0, callout: "Above the fold" },
      },
      {
        screenId: "screen_4",
        finding: "Skip affordance is below platform 44dp tap-target guideline — accessibility risk.",
        severity: "watch_item",
        confidence: "observed",
        annotation: { mode: "element", elementIndex: 2, callout: "Tiny target" },
      },
    ],
  };
}

test("synthesizeAnnotations: happy path returns ok+annotations+tokenUsage", async () => {
  const fixture = buildFixture();
  const out = await synthesizeAnnotations({
    screenId: "screen_4",
    width: fixture.width,
    height: fixture.height,
    elements: fixture.elements,
    findings: fixtureFindings(),
    image: fixture.buffer,
    deps: { client: mockClient(validToolReturn(fixture)) },
  });
  assert.equal(out.ok, true);
  assert.equal(out.annotations.findings.length, 2);
  assert.equal(out.tokenUsage.input_tokens, 1200);
  assert.equal(out.tokenUsage.output_tokens, 400);
});

test("synthesizeAnnotations: vision message includes the image as base64 image content", async () => {
  const fixture = buildFixture();
  let captured = null;
  await synthesizeAnnotations({
    screenId: "screen_4",
    width: fixture.width,
    height: fixture.height,
    elements: fixture.elements,
    findings: fixtureFindings(),
    image: fixture.buffer,
    deps: {
      client: mockClient(validToolReturn(fixture), {
        captureRequest: (req) => { captured = req; },
      }),
    },
  });
  assert.ok(captured, "client.messages.create should have been called");
  const userContent = captured.messages[0].content;
  assert.ok(Array.isArray(userContent), "user content should be a content-block array for vision");
  const imageBlock = userContent.find((b) => b.type === "image");
  assert.ok(imageBlock, "image block must be present");
  assert.equal(imageBlock.source.type, "base64");
  assert.equal(imageBlock.source.media_type, "image/png");
  assert.ok(imageBlock.source.data.length > 100);
  // Tool gating: must force-call our tool, not let the model decide.
  assert.equal(captured.tool_choice.type, "tool");
  assert.equal(captured.tool_choice.name, ANNOTATION_TOOL.name);
});

test("synthesizeAnnotations: rejects out-of-range elementIndex (cross-check)", async () => {
  const fixture = buildFixture();
  const bad = validToolReturn(fixture);
  bad.findings[0].annotation.elementIndex = 99;
  const out = await synthesizeAnnotations({
    screenId: "screen_4",
    width: fixture.width,
    height: fixture.height,
    elements: fixture.elements,
    findings: fixtureFindings(),
    image: fixture.buffer,
    deps: { client: mockClient(bad) },
  });
  assert.equal(out.ok, false);
  assert.ok(out.errors.some((e) => e.includes("elementIndex") && e.includes("out of range")));
});

test("synthesizeAnnotations: rejects too-short justification on region mode", async () => {
  const fixture = buildFixture();
  const bad = validToolReturn(fixture);
  bad.findings[0].annotation = {
    mode: "region",
    bounds: { x1: 0.1, y1: 0.1, x2: 0.5, y2: 0.5 },
    justification: "no element", // < 20 chars — schema violation
    callout: "X",
  };
  const out = await synthesizeAnnotations({
    screenId: "screen_4",
    width: fixture.width,
    height: fixture.height,
    elements: fixture.elements,
    findings: fixtureFindings(),
    image: fixture.buffer,
    deps: { client: mockClient(bad) },
  });
  assert.equal(out.ok, false);
});

test("synthesizeAnnotations: returns model_did_not_call_tool when model emits text only", async () => {
  const fixture = buildFixture();
  const out = await synthesizeAnnotations({
    screenId: "screen_4",
    width: fixture.width,
    height: fixture.height,
    elements: fixture.elements,
    findings: fixtureFindings(),
    image: fixture.buffer,
    deps: { client: mockClient(null, { skipTool: true }) },
  });
  assert.equal(out.ok, false);
  assert.ok(out.errors.includes("model_did_not_call_tool"));
});

test("synthesizeAnnotations: surfaces SDK errors as anthropic_sdk_failed", async () => {
  const fixture = buildFixture();
  const out = await synthesizeAnnotations({
    screenId: "screen_4",
    width: fixture.width,
    height: fixture.height,
    elements: fixture.elements,
    findings: fixtureFindings(),
    image: fixture.buffer,
    deps: {
      client: mockClient(null, { throwError: new Error("rate_limit_exceeded") }),
    },
  });
  assert.equal(out.ok, false);
  assert.ok(out.errors.some((e) => e.includes("anthropic_sdk_failed")));
});

test("synthesizeAnnotations: refuses to run with empty findings array", async () => {
  const fixture = buildFixture();
  const out = await synthesizeAnnotations({
    screenId: "screen_4",
    width: fixture.width,
    height: fixture.height,
    elements: fixture.elements,
    findings: [],
    image: fixture.buffer,
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
  assert.equal(out.ok, false);
  assert.ok(out.errors.some((e) => e.includes("at least one finding")));
});

test("synthesizeAnnotations: refuses to run with missing screenId", async () => {
  const fixture = buildFixture();
  const out = await synthesizeAnnotations({
    width: fixture.width,
    height: fixture.height,
    elements: fixture.elements,
    findings: fixtureFindings(),
    image: fixture.buffer,
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
  assert.equal(out.ok, false);
  assert.ok(out.errors.some((e) => e.includes("screenId")));
});
