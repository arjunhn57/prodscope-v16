"use strict";

/**
 * output/annotator/synthesize.js — annotation-pass synthesizer.
 *
 * One Sonnet vision call per cited screen. Returns a Zod-validated,
 * elementIndex-cross-checked annotations object. Same failure-envelope
 * shape as synthesizeReportV2 — the caller decides whether to retry,
 * fall back to whole_screen captions, or skip annotations entirely.
 *
 * Vision input: the screenshot is base64-encoded and attached as an
 * image content block. The classifier's element list is embedded in
 * the prompt text so the model can cite by index.
 */

const fs = require("fs");
const path = require("path");
const Anthropic = require("@anthropic-ai/sdk");
const { logger } = require("../../lib/logger");
const { ANNOTATION_TOOL } = require("./tool");
const { buildAnnotationPrompt } = require("./prompt");
const { validateScreenAnnotations } = require("./schema");
const { ANALYSIS_MODEL, REPORT_MODEL } = require("../../config/defaults");

const log = logger.child({ component: "annotator-synthesize" });

const defaultClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const DEFAULT_MAX_TOKENS = 1500;
const DEFAULT_TEMPERATURE = 0.2;

/**
 * Read an image and return its base64-encoded contents + mime type. Used
 * to build the Anthropic vision content block.
 *
 * @param {string|Buffer} input
 * @returns {{ data: string, mediaType: "image/png" | "image/jpeg" } | { error: string }}
 */
function loadImageForVision(input) {
  let buf;
  let pathHint = "";
  if (Buffer.isBuffer(input)) {
    buf = input;
  } else if (typeof input === "string") {
    if (!fs.existsSync(input)) {
      return { error: `image not found: ${input}` };
    }
    try {
      buf = fs.readFileSync(input);
    } catch (err) {
      return { error: `image read failed: ${err && err.message ? err.message : String(err)}` };
    }
    pathHint = input;
  } else {
    return { error: "image must be a path or Buffer" };
  }
  const mediaType = inferMediaType(pathHint, buf);
  return { data: buf.toString("base64"), mediaType };
}

function inferMediaType(pathHint, buf) {
  const ext = (path.extname(pathHint) || "").toLowerCase();
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".png") return "image/png";
  // Sniff magic bytes — PNG: 89 50 4E 47, JPEG: FF D8 FF.
  if (buf.length >= 4 && buf[0] === 0x89 && buf[1] === 0x50) return "image/png";
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  return "image/png";
}

function extractToolInput(response) {
  if (!response || !Array.isArray(response.content)) return null;
  for (const block of response.content) {
    if (block && block.type === "tool_use" && block.name === ANNOTATION_TOOL.name) {
      return block.input && typeof block.input === "object" ? block.input : null;
    }
  }
  return null;
}

/**
 * Synthesize annotations for a single screen.
 *
 * @param {Object} params
 * @param {string} params.screenId          "screen_<step>"
 * @param {number} params.width
 * @param {number} params.height
 * @param {Array<{bounds:[number,number,number,number], label?: string}>} params.elements
 * @param {Array<object>} params.findings   Pre-existing findings to annotate.
 * @param {string|Buffer} params.image      Screenshot path or buffer.
 * @param {string} [params.context]         Optional context paragraph.
 * @param {Object} [params.deps]            Inject `client` for tests.
 * @returns {Promise<{ok:true, annotations:object, tokenUsage:object} | {ok:false, errors:string[], tokenUsage?:object, rawInput?:object}>}
 */
async function synthesizeAnnotations(params) {
  const { screenId, width, height, elements, findings, image, context, deps } = params;
  const client = (deps && deps.client) || defaultClient;

  if (!screenId || typeof screenId !== "string") {
    return { ok: false, errors: ["screenId is required"] };
  }
  if (!Array.isArray(findings) || findings.length === 0) {
    return { ok: false, errors: ["at least one finding is required"] };
  }

  const img = loadImageForVision(image);
  if (img.error) {
    return { ok: false, errors: [img.error] };
  }

  const prompt = buildAnnotationPrompt({
    screenId,
    width,
    height,
    elements: elements || [],
    findings,
    context,
  });

  const model = REPORT_MODEL || ANALYSIS_MODEL;

  let response;
  try {
    response = await client.messages.create({
      model,
      max_tokens: DEFAULT_MAX_TOKENS,
      temperature: DEFAULT_TEMPERATURE,
      tools: [ANNOTATION_TOOL],
      tool_choice: { type: "tool", name: ANNOTATION_TOOL.name },
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: img.mediaType,
                data: img.data,
              },
            },
            { type: "text", text: prompt },
          ],
        },
      ],
    });
  } catch (err) {
    log.error(
      { err: err && err.message, screenId },
      "synthesizeAnnotations: SDK call failed",
    );
    return {
      ok: false,
      errors: [`anthropic_sdk_failed: ${err && err.message ? err.message : "unknown"}`],
    };
  }

  const tokenUsage = {
    input_tokens: (response.usage && response.usage.input_tokens) || 0,
    output_tokens: (response.usage && response.usage.output_tokens) || 0,
  };

  const rawInput = extractToolInput(response);
  if (!rawInput) {
    log.warn(
      { screenId, stop_reason: response.stop_reason },
      "synthesizeAnnotations: model did not emit emit_annotations tool call",
    );
    return {
      ok: false,
      errors: ["model_did_not_call_tool"],
      tokenUsage,
    };
  }

  const validation = validateScreenAnnotations(rawInput);
  if (!validation.ok) {
    log.warn(
      { screenId, errors: validation.errors.slice(0, 5) },
      "synthesizeAnnotations: validation failed",
    );
    return {
      ok: false,
      errors: validation.errors,
      tokenUsage,
      rawInput,
    };
  }

  return { ok: true, annotations: validation.annotations, tokenUsage };
}

module.exports = {
  synthesizeAnnotations,
  // exposed for tests
  loadImageForVision,
  extractToolInput,
};
