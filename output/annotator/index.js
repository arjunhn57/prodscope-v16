"use strict";

/**
 * output/annotator — annotated screenshot infrastructure for V2 reports.
 *
 * Path B of the report-quality work. Pairs a textual finding with a
 * pixel-precise visual annotation: solid box on a classifier-known
 * element, dashed box on a justified free-form region, or a caption
 * strip on the whole screen. Severity / confidence encoded as halo
 * intensity / width — stroke color stays brand-accent on every box.
 *
 * Public surface:
 *   - renderAnnotated({ image, annotations })   -> { ok, buffer, ... }
 *   - renderZoom({ image, annotations, findingIndex }) -> { ok, buffer, ... }
 *   - validateScreenAnnotations(input)           -> { ok, annotations | errors }
 *   - schemas (Zod) re-exported for prompt builders that want to sync
 *     their tool input_schema with the renderer's contract.
 */

const { renderAnnotated } = require("./render");
const { renderZoom } = require("./zoom");
const schema = require("./schema");
const style = require("./style");

module.exports = {
  renderAnnotated,
  renderZoom,
  validateScreenAnnotations: schema.validateScreenAnnotations,
  schema,
  style,
};
