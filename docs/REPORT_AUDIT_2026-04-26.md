# Current report audit — what produces "phrases without proof"

Audit of: `output/report-builder.js`, `oracle/ai-oracle.js`, `brain/context-builder.js`, `frontend/src/features/report/types.ts`.
Reference user complaint: *"very bad — just communicating with phrases without proof."*

This document is the defect log that grounds the rebuild. Each defect names the file, the line, and the fix shape.

---

## Defect #1 — The Sonnet synthesis prompt has zero citation contract

**File:** `brain/context-builder.js:62-118` (`buildReportPrompt`)

The prompt's final line is:

```
Generate JSON: {"overall_score":0-100,"summary":"...","critical_bugs":[],
"ux_issues":[],"suggestions":[],"quick_wins":[],
"recommended_next_steps":[],"coverage_assessment":"..."}
```

That's it. No "every claim must cite a screen." No "you may not invent findings not present in the input." No confidence ladder. No evidence requirement. The model is given Stage 2 findings as a flat dump and asked to "generate JSON."

**Result:** Sonnet writes prose-style descriptions like *"the app appears to have onboarding friction"* with zero grounding. The cited Stage 2 findings already had `evidence` strings — the synthesis pass strips them and replaces with narrative.

**Fix:** Replace this prompt entirely. New prompt, new tool schema, every claim required to carry a `screenId` array of length ≥1. Hallucination becomes a schema rejection, not a stylistic choice.

---

## Defect #2 — Report tool schema doesn't require evidence anywhere

**File:** `output/report-builder.js:166-258` (`REPORT_TOOL.input_schema`)

Field-by-field damage:

| Field | Type | Citation required? | Fix |
|---|---|---|---|
| `summary` | "2-4 sentence executive summary" | ❌ no | replace with structured `verdict` object: 3 separate `claim+evidence+confidence` objects |
| `critical_bugs[].title` | string | ❌ | require `evidence_screen_ids: string[]`, `severity_rationale: string` |
| `critical_bugs[].description` | free string | ❌ | force structured: `claim`, `observed_at_screen_ids`, `confidence` |
| `critical_bugs[].step` | number | optional | required + extended to array (a bug can span multiple screens) |
| `ux_issues[]` | title+description+severity | ❌ no screen ref at all | same fix as critical_bugs |
| `suggestions[].title/description/effort` | strings | ❌ | require evidence chain — what would be improved, on which screen |
| `quick_wins[]` | title+description | ❌ | derived deterministically from suggestions where `effort=low` — no LLM needed |
| `recommended_next_steps` | `string[]` | ❌ | replace with founder-question objects (each tied to a flag) |
| `coverage_assessment` | "1-2 sentence verdict" | ❌ | replace with structured numbers: screens reached, sections covered, gaps with reasons |
| `overall_score` | number 0-100 | ❌ | either delete or rebuild as deterministic-only computation with named inputs |

**Fix:** discard this schema; replace with the schema in the plan file (`claim+confidence+evidence` discriminated union per finding type). Every leaf field that contains a claim has a `evidence: ScreenRef[]` neighbor with `min(1)`.

---

## Defect #3 — Stage 2 evidence is collected, then dropped

**File:** `output/report-builder.js:97-107` (`renderDeterministicReport` field mapping)

```js
const uniqueBugs = dedupeByTitle(sortedBugs).map((b) => ({
  title: b.title,
  description: b.evidence || b.description || "",  // <- evidence demoted to fallback
  severity: b.severity || "high",
  confidence: b.confidence,
  step: b.step,
  screen_type: b.screenType,
}));
```

The Haiku Stage 2 output **does** carry `evidence: string` per finding (see `oracle/ai-oracle.js:43`). But the deterministic renderer flattens it into `description` and loses any structured screen reference beyond a single `step` number. The Sonnet path is even worse — the prompt doesn't pass the per-finding evidence through at all (see `aiLines` flattening in `buildReportPrompt:88`).

**Fix:** Preserve the screen reference end-to-end. Stage 2's `evidence` becomes a structured `evidence: { screenIds: string[], notes: string }` object that survives every aggregation step. Stage 3 synthesis is forbidden from generating findings whose evidence didn't come from Stage 2.

---

## Defect #4 — `overall_score` is fabricated

**File:** `output/report-builder.js:109-114` (deterministic path) and Sonnet path (no constraint)

Deterministic path:
```
10 baseline, -2 per critical_bug, -1 per high-severity ux_issue
floored at 1, ceilinged at 10
```

That's a number with no defensible mapping to anything investors recognize. A diligence reader sees "Overall score: 6/10" and mentally discounts the entire report — they know a 6 isn't grounded in anything.

Sonnet path is worse: the model invents a score in the 0-100 range with no rules at all.

**Fix:** Drop `overall_score` entirely. Replace with a structured score-card on the verdict page:

```
Coverage:    74% of estimated screens   (observed)
Stability:   2 crashes in 80 steps      (observed)
Auth gates:  4 found, 1 dismissable     (observed)
Monetization: paywall not reached       (gap)
```

Numbers, not vibes. Each row links to its source. No single number that pretends to be "the answer."

---

## Defect #5 — Recommended next steps are generic platitudes

**Sonnet path output (typical):** `["Improve onboarding flow", "Add accessibility labels", "Reduce app size"]`.

These are textbook mobile-UX advice. They could be appended to any app's report. They produce zero leverage for the reader.

**Fix per the plan:** every recommended next step becomes a **specific question to ask the founder**, tied to a specific finding, tied to a specific screen.

```
🔴 Auth wall reached on screen 4 — full-screen "Sign in" before any feed loads.
   Ask the founder: "What's your D1/D7 split between authenticated and
   unauthenticated cohorts? Why gate browsing pre-account-creation?"
```

That's a specific question someone else couldn't ask without paying for this report. That's the deliverable.

---

## Defect #6 — Frontend type allows evidence to be optional

**File:** `frontend/src/features/report/types.ts:138`

```ts
export interface Recommendation {
  id: string;
  title: string;
  area: ...;
  severity: Severity;
  effort: ...;
  description: string;
  linkedFindingIds?: string[];   // <- optional
}
```

Optional means most renders won't have it. The frontend has no way to enforce the citation rule because the type doesn't require it.

**Fix:** flip optionality. `linkedFindingIds: string[]` (required, min 1). Findings themselves carry `linkedScreenIds: string[]` (required, min 1). The compiler will then surface every place we currently render a recommendation without evidence.

---

## Defect #7 — Adjectives-without-citation appear in the deterministic summary too

**File:** `output/report-builder.js:118-122` (the deterministic-renderer summary)

```js
const summary =
  `Automated analysis of ${screensAnalyzed} deep-analyzed screens surfaced ` +
  `${uniqueBugs.length} high-confidence critical bug${...} ` +
  `and ${uniqueUx.length} UX issue${...}. ` +
  `This report was rendered from structured Stage 2 findings (no prose synthesis).`;
```

Even the "no prose synthesis" path produces a sentence summary that exposes the rendering method ("structured Stage 2 findings") to the user — violates the memory rule about hiding implementation. It's also pure narrative — no concrete numbers (which sections, which severity mix, which categories absent).

**Fix:** Replace with a structured `verdict` object on the verdict page (see plan). Three claim+evidence triples. No exposed implementation.

---

## Defect #8 — `aiLines` compressor in the prompt drops the screen identity

**File:** `brain/context-builder.js:88-99`

```js
const aiLines = (aiFindings || [])
  .map((a) => {
    const bugs = (a.bugs || []).map((b) => `[BUG:${b.severity}] ${b.desc}`).join("; ");
    ...
    return `Step ${a.step} (${a.screenType}, feature=${a.feature || "unknown"}): ${all || "no issues"}`;
  })
  .join("\n");
```

The model receives a prose dump of "Step 14 (auth, feature=login): [BUG:high] Email field not focusable; [UX:medium] OTP screen does not paste from clipboard". The `step` number is the only screen identifier, and the model can't easily preserve it through synthesis because it's embedded in prose.

**Fix:** Pass findings as structured JSON to the model, not as a prose blob. Include a per-screen index it must reference by id (e.g., `screen_14`). The synthesizer prompt explicitly says: "Cite a screen id from the provided findings list. Inventing a screen id is a violation."

---

## Defect #9 — Two failure-mode escape hatches OK; the success path is the problem

Note worth recording: the existing code has *good* graceful-degradation (`analysis_suppressed: true` for blocked_by_auth, thin_ai_coverage, budget_exhausted_early; `critical_bugs_suppressed: true` for thin coverage). These are honest and should be preserved.

The defect is in the **success path** — when the data is rich enough to publish, the synthesis layer produces low-evidence narrative. The suppression layer is fine; the synthesis layer is broken.

**Fix:** Keep the existing suppression gates. Replace only the success path's prompt + schema.

---

## Defect #10 — No "what we didn't see" structure

When the crawl succeeds but didn't reach (e.g.) the payment screen, the report is silent on that. A diligence reader doesn't know whether absence-of-finding means "we looked and there's no problem" or "we never got there."

**Fix per plan:** `coverage` section explicitly lists what was reached vs. what was attempted-but-blocked vs. what was not attempted. Each "not reached" row has a reason. This is a section, not a sentence.

---

## Summary of changes the rebuild needs

1. **New synthesis tool schema** with citation-required leaves (Defects #1, #2, #6).
2. **Evidence carried end-to-end** from Stage 2 through Sonnet through the frontend type (Defect #3, #8).
3. **Verdict / score-card replaces `overall_score` + `summary`** (Defects #4, #7).
4. **Founder-question per flag** replaces `recommended_next_steps` (Defect #5).
5. **Coverage section** with "reached / attempted / not attempted" structure (Defect #10).
6. **Existing suppression gates preserved as-is** — they're working (note from #9).

## What the rebuild does NOT need to change

- The Stage 2 (Haiku per-screen) tool schema — it already collects severity + confidence + evidence. Just the consumer needs to stop dropping those fields.
- The Stage 3 routing logic — skip-Sonnet-when-thin-coverage is correct.
- The frontend `useReportData` defensive normalization — keep tolerating missing fields gracefully.
- The deterministic-findings (UX heuristics in `oracle/ux-heuristics.js`) — those already produce step + element citations.

## Estimated impact

- ~80% of "phrases without proof" comes from Defect #1 (the Sonnet prompt + schema).
- Fixing Defect #2 alone (the report tool schema) forces Sonnet to emit citations.
- The remaining 20% is Defects #3 (evidence dropped in aggregation) and #8 (prose-blob input).

If we land just the schema rewrite + the carry-evidence-through fix, the report goes from "AI essay with footnotes" to "evidence-grounded structured findings" — most of the value of the redesign with one tight code change.

Path A in the plan is exactly this fix. We start there.
