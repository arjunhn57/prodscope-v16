"use strict";

/**
 * output/annotator/prompt.js — annotation-pass prompt builder.
 *
 * Same forensic-not-creative discipline as the V2 report prompt. The
 * model gets the screenshot (as vision input, attached separately by
 * the synthesizer), an indexed list of classifier-known clickables, and
 * the text findings that need visual citations. It MUST emit one
 * annotation per finding via the emit_annotations tool.
 *
 * The cardinal rule from the V2 report carries over: every claim cites
 * concrete evidence. Here, "evidence" means a pixel location — either
 * a known element index, or a justified free-form region, or a
 * whole-screen caption.
 */

/**
 * @param {Object} params
 * @param {string} params.screenId            "screen_<step>"
 * @param {number} params.width
 * @param {number} params.height
 * @param {Array<{bounds: [number, number, number, number], label?: string}>} params.elements
 * @param {Array<{kind?: string, severity?: string, confidence?: string|number, title?: string, evidence?: string, claim?: string}>} params.findings
 *        Pre-existing findings about this screen (from Stage 2 + V2 report).
 *        The annotator's job is to attach a visual annotation to each.
 * @param {string} [params.context]           Optional one-paragraph context
 *                                            (app type, where in the flow)
 * @returns {string}
 */
function buildAnnotationPrompt({
  screenId,
  width,
  height,
  elements,
  findings,
  context,
}) {
  const elementLines = (elements || [])
    .map((el, i) => {
      const [x1, y1, x2, y2] = el.bounds;
      const w = x2 - x1;
      const h = y2 - y1;
      const labelPart = el.label ? ` — "${truncate(el.label, 50)}"` : "";
      return `  [${i}] (${x1},${y1})-(${x2},${y2}) (${w}×${h}px)${labelPart}`;
    })
    .join("\n");

  const findingLines = (findings || [])
    .map((f, i) => {
      const sev = f.severity ? ` [${f.severity}]` : "";
      const text = f.evidence || f.claim || f.title || "(no detail)";
      return `  ${i + 1}.${sev} ${truncate(text, 240)}`;
    })
    .join("\n");

  return `You are a forensic UX analyst annotating a single Android screenshot for a $200 diligence report.

A senior diligence reader will look at this screenshot for 3 seconds. They need to see — at a glance — exactly which element each finding refers to. Your job is to draw the visual citation that makes the textual claim defensible.

# The screen

screenId: ${screenId}
size: ${width}px × ${height}px wide (Android pixel coords; (0,0) is top-left)

${context ? `Context: ${context}\n` : ""}
# Classifier-known clickable elements

The Android XML hierarchy at capture time exposed these clickable elements with pixel-precise bounds. You may cite any of them by index (mode=element, elementIndex). Pixel-precise; no hallucination possible.

${elementLines || "  (no clickable elements — every annotation must use mode=region or mode=whole_screen)"}

# Findings to annotate (one annotation per finding, in order)

${findingLines || "  (no findings — emit zero annotations? this would be invalid; caller should not have invoked you)"}

# How to choose annotation mode

For each finding, pick exactly one mode:

1. **mode=element** — preferred default. If the finding is about a specific button, input, icon, or other classified clickable, cite its index. Pixel-precise.

2. **mode=region** — only when NO classified element matches. Use 0..1 normalized bounds (so the box survives image resizes). You MUST include a 20-160 char justification defending why no element index suffices. Examples of legitimate region use:
   - Floating tooltip / overlay rendered outside the activity hierarchy
   - Blank-space observation ("nothing here when something should be")
   - Group of multiple elements that together form the finding
   Bad uses (will be rejected): laziness, "the whole screen", anything that overlaps a classified element.

3. **mode=whole_screen** — only for findings that genuinely span the whole screen (e.g. "overall feel is rushed", "too much copy before first interaction"). Caption only, no box.

# Forbidden phrases in the callout

The callout is the text next to the badge — keep it ≤40 chars and FORENSIC, not creative:

- ❌ "looks bad", "feels off", "appears unfriendly"
- ❌ "could be improved"
- ✅ "Above the fold", "44dp tap target", "No paste affordance"

# Output

Call the emit_annotations tool. One annotation per input finding, in input order. Include the input width/height/elements verbatim so the renderer can validate. Do not invent extra findings.`;
}

function truncate(s, n) {
  if (typeof s !== "string") return "";
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + "…";
}

module.exports = { buildAnnotationPrompt };
