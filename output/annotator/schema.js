"use strict";

/**
 * output/annotator/schema.js — Zod schemas for the annotation pass.
 *
 * One annotations.json per screenshot. Each annotation cites a finding
 * and either points at a classifier-known element (mode=element,
 * pixel-precise from the Android XML hierarchy) or a free-form region
 * (mode=region, requires a justification so the synthesizer can't lazy
 * default to free-form drawing) or a whole-screen caption (mode=
 * whole_screen, no box, used for flow-level findings).
 *
 * The discriminated union is the load-bearing constraint — it makes
 * "hallucinated bounds" a schema violation rather than a stylistic
 * choice. See plan: nifty-nibbling-widget.md, "Architectural correction
 * — bounds source."
 */

const { z } = require("zod");

// Severity ladder for ring intensity / color tint. Distinct from the
// confidence ladder — a finding can be `concern` (high severity) and
// `inferred` (medium confidence).
const SeveritySchema = z.enum(["concern", "watch_item", "strength"]);

const ConfidenceSchema = z.enum(["observed", "inferred", "hypothesis"]);

// mode=element: classifier picks a known clickable index. The renderer
// looks up the bounds by index from the screen's element list. Pixel
// precise; no hallucination possible.
const ElementAnnotationSchema = z.object({
  mode: z.literal("element"),
  elementIndex: z.number().int().min(0),
  callout: z.string().min(1).max(40),
});

// mode=region: free-form box, allowed only when no classified element
// fits. The justification field forces the synthesizer to defend the
// looser bounds — without it, the prompt would default to region for
// everything. Bounds are 0..1 normalized so they survive resizes.
const RegionAnnotationSchema = z.object({
  mode: z.literal("region"),
  bounds: z.object({
    x1: z.number().min(0).max(1),
    y1: z.number().min(0).max(1),
    x2: z.number().min(0).max(1),
    y2: z.number().min(0).max(1),
  }).refine(
    (b) => b.x2 > b.x1 && b.y2 > b.y1,
    { message: "bounds must have positive area: x2 > x1 and y2 > y1" },
  ),
  justification: z.string().min(20).max(160),
  callout: z.string().min(1).max(40),
});

// mode=whole_screen: no box. Caption appears below the image (or as a
// banner) for flow-level findings that aren't tied to a specific spot.
const WholeScreenAnnotationSchema = z.object({
  mode: z.literal("whole_screen"),
  callout: z.string().min(1).max(80),
});

const AnnotationModeSchema = z.discriminatedUnion("mode", [
  ElementAnnotationSchema,
  RegionAnnotationSchema,
  WholeScreenAnnotationSchema,
]);

// Top-level finding — pairs a textual claim with a visual annotation.
// `screenId` matches the report's screen_<step> id so the report
// renderer can look up the screenshot.
const AnnotatedFindingSchema = z.object({
  screenId: z.string().regex(/^screen_\d+$/, "screenId must be 'screen_<step>'"),
  finding: z.string().min(20).max(280),
  severity: SeveritySchema,
  confidence: ConfidenceSchema,
  annotation: AnnotationModeSchema,
});

// Per-screen annotations.json shape.
const ScreenAnnotationsSchema = z.object({
  screenId: z.string().regex(/^screen_\d+$/),
  // The screenshot's pixel dimensions at capture time. Element bounds
  // (from the Android XML hierarchy) are absolute pixels at this size,
  // so the renderer needs them to scale correctly when the rendered
  // canvas differs (e.g. for high-DPI export).
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  // The classifier's clickable list at capture time. Each element's
  // `bounds` is in pixel coords [x1, y1, x2, y2]. mode=element refers
  // into this list by index.
  elements: z.array(z.object({
    bounds: z.tuple([
      z.number().int().nonnegative(),
      z.number().int().nonnegative(),
      z.number().int().positive(),
      z.number().int().positive(),
    ]),
    label: z.string().optional(),
  })),
  findings: z.array(AnnotatedFindingSchema).min(1).max(8),
});

/**
 * Validate annotations.json + cross-check that every mode=element
 * annotation references an in-range index. Returns either:
 *   { ok: true, annotations }
 *   { ok: false, errors: string[] }
 *
 * @param {unknown} input
 * @returns {{ok: true, annotations: object} | {ok: false, errors: string[]}}
 */
function validateScreenAnnotations(input) {
  const parsed = ScreenAnnotationsSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map(
        (i) => `${i.path.join(".") || "root"}: ${i.message}`,
      ),
    };
  }

  const a = parsed.data;
  const errors = [];
  for (let i = 0; i < a.findings.length; i++) {
    const f = a.findings[i];
    if (f.annotation.mode === "element") {
      if (f.annotation.elementIndex >= a.elements.length) {
        errors.push(
          `findings[${i}].annotation.elementIndex: ${f.annotation.elementIndex} ` +
          `out of range (only ${a.elements.length} elements available)`,
        );
      }
    }
  }
  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return { ok: true, annotations: a };
}

module.exports = {
  SeveritySchema,
  ConfidenceSchema,
  ElementAnnotationSchema,
  RegionAnnotationSchema,
  WholeScreenAnnotationSchema,
  AnnotationModeSchema,
  AnnotatedFindingSchema,
  ScreenAnnotationsSchema,
  validateScreenAnnotations,
};
