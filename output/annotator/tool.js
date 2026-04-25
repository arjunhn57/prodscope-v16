"use strict";

/**
 * output/annotator/tool.js — Anthropic tool definition for the annotation pass.
 *
 * Mirrors the Zod ScreenAnnotationsSchema so the model is constrained at
 * the API boundary. Same enforcement contract as the V2 report tool —
 * tool input_schema rejects calls without justification on region mode,
 * without callout, without bounded findings array length, etc. Zod
 * re-validation in the synthesizer catches anything the JSON-schema
 * layer misses (e.g. 0..1 normalized region bounds, the screenId regex).
 */

const ANNOTATION_TOOL = {
  name: "emit_annotations",
  description:
    "Emit visual annotations for a single screenshot. Each annotation pairs " +
    "a finding with one of three modes:\n\n" +
    "  - mode=element: cite a classifier-known clickable by index. Use this " +
    "when the finding is about a specific element (button, input, icon). " +
    "Pixel-precise — no hallucinated bounds.\n" +
    "  - mode=region: free-form bounds in 0..1 normalized coords. Use ONLY " +
    "when no classified element fits the finding (floating tooltips, " +
    "overlays, blank-area observations). Requires a 20-160 char " +
    "justification defending why no element index suffices.\n" +
    "  - mode=whole_screen: caption only, no box. Use for flow-level " +
    "findings that span the whole screen (e.g. 'overall onboarding feels " +
    "rushed', 'too much legal copy on first screen').\n\n" +
    "You MUST cite at least one finding. You MAY emit up to 8. Each finding " +
    "must include a severity (concern/watch_item/strength), a confidence " +
    "(observed/inferred/hypothesis), and a callout phrase (≤40 chars) that " +
    "appears next to the badge.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    required: ["screenId", "width", "height", "elements", "findings"],
    properties: {
      screenId: {
        type: "string",
        pattern: "^screen_\\d+$",
        description: "Echo back the input screen id, e.g. 'screen_4'.",
      },
      width: {
        type: "integer",
        minimum: 1,
        description: "Echo back the screenshot's pixel width.",
      },
      height: {
        type: "integer",
        minimum: 1,
        description: "Echo back the screenshot's pixel height.",
      },
      elements: {
        type: "array",
        description:
          "Echo back the input element list verbatim — the renderer uses " +
          "this to resolve elementIndex references.",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["bounds"],
          properties: {
            bounds: {
              type: "array",
              minItems: 4,
              maxItems: 4,
              items: { type: "integer", minimum: 0 },
              description: "[x1, y1, x2, y2] in pixel coords.",
            },
            label: { type: "string" },
          },
        },
      },
      findings: {
        type: "array",
        minItems: 1,
        maxItems: 8,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["screenId", "finding", "severity", "confidence", "annotation"],
          properties: {
            screenId: { type: "string", pattern: "^screen_\\d+$" },
            finding: {
              type: "string",
              minLength: 20,
              maxLength: 280,
              description:
                "20-280 char observation. Forensic, not creative — cite " +
                "what's visible. No 'appears to', no 'seems'.",
            },
            severity: { type: "string", enum: ["concern", "watch_item", "strength"] },
            confidence: { type: "string", enum: ["observed", "inferred", "hypothesis"] },
            annotation: {
              oneOf: [
                {
                  type: "object",
                  additionalProperties: false,
                  required: ["mode", "elementIndex", "callout"],
                  properties: {
                    mode: { type: "string", const: "element" },
                    elementIndex: {
                      type: "integer",
                      minimum: 0,
                      description: "Index into the input elements[] list.",
                    },
                    callout: { type: "string", minLength: 1, maxLength: 40 },
                  },
                },
                {
                  type: "object",
                  additionalProperties: false,
                  required: ["mode", "bounds", "justification", "callout"],
                  properties: {
                    mode: { type: "string", const: "region" },
                    bounds: {
                      type: "object",
                      additionalProperties: false,
                      required: ["x1", "y1", "x2", "y2"],
                      properties: {
                        x1: { type: "number", minimum: 0, maximum: 1 },
                        y1: { type: "number", minimum: 0, maximum: 1 },
                        x2: { type: "number", minimum: 0, maximum: 1 },
                        y2: { type: "number", minimum: 0, maximum: 1 },
                      },
                    },
                    justification: {
                      type: "string",
                      minLength: 20,
                      maxLength: 160,
                      description:
                        "20-160 chars defending why no classified element " +
                        "fits. Without this defense the synthesizer would " +
                        "default to free-form drawing for everything.",
                    },
                    callout: { type: "string", minLength: 1, maxLength: 40 },
                  },
                },
                {
                  type: "object",
                  additionalProperties: false,
                  required: ["mode", "callout"],
                  properties: {
                    mode: { type: "string", const: "whole_screen" },
                    callout: { type: "string", minLength: 1, maxLength: 80 },
                  },
                },
              ],
            },
          },
        },
      },
    },
  },
};

module.exports = { ANNOTATION_TOOL };
