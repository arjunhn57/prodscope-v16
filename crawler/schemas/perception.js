"use strict";

/**
 * perception.js — Zod schema for vision-perception LLM responses.
 *
 * Replaces ~80 lines of hand-rolled validation in vision-perception.js with a
 * declarative schema. `.catch()` on every field makes the schema forgiving:
 * a malformed LLM response never throws, it just returns a safe default.
 *
 * Post-parse normalization (percentage → pixel conversion, clamping,
 * navBar.hasNav recomputation) lives in `normalizePerception()` below
 * because it depends on runtime viewport dimensions from adb.getScreenSize().
 */

const { z } = require("zod");

const SCREEN_TYPES = [
  "feed", "settings", "detail", "login", "search",
  "dialog", "form", "nav_hub", "error", "loading", "other",
];

const DENSITIES = ["high", "medium", "low", "empty"];
const PRIORITIES = ["high", "medium", "low"];

// Match the previous hand-rolled `!!obj.field` behavior: any truthy → true,
// any falsy (including undefined) → false. `z.boolean().catch(false)` would
// collapse `"true"` → false, which the LLM sometimes emits.
const looseBoolean = z.unknown().transform((v) => Boolean(v));

const navTabSchema = z.object({
  label: z.string().catch(""),
  x: z.number().catch(NaN),
  y: z.number().catch(NaN),
});

const mainActionSchema = z.object({
  description: z.string().catch("tap"),
  x: z.number().catch(NaN),
  y: z.number().catch(NaN),
  priority: z.enum(PRIORITIES).catch("medium"),
});

const perceptionResponseSchema = z.object({
  screenType: z.enum(SCREEN_TYPES).catch("other"),
  screenDescription: z.string().catch(""),
  navBar: z.object({
    hasNav: looseBoolean,
    tabs: z.array(navTabSchema).catch([]),
  }).catch({ hasNav: false, tabs: [] }),
  mainActions: z.array(mainActionSchema).catch([]),
  isAuthScreen: looseBoolean,
  isLoading: looseBoolean,
  contentDensity: z.enum(DENSITIES).catch("medium"),
});

/**
 * Parse a raw string (possibly wrapped in markdown fences) into a validated
 * perception object. Returns `null` if the input is not valid JSON at all —
 * shape validation errors are absorbed by `.catch()` on each field.
 *
 * @param {string} text
 * @returns {ReturnType<typeof perceptionResponseSchema.parse> | null}
 */
function parsePerceptionJson(text) {
  const cleaned = String(text || "")
    .replace(/^```json\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  let raw;
  try {
    raw = JSON.parse(cleaned);
  } catch {
    return null;
  }

  const result = perceptionResponseSchema.safeParse(raw);
  return result.success ? result.data : null;
}

/**
 * Normalize a parsed perception in place:
 *   - Drop tabs/actions with non-finite coordinates
 *   - Convert 0-100 percentage coordinates to pixels using screen dims
 *   - Clamp coordinates to [margin, screen - margin]
 *   - Recompute navBar.hasNav from the final tab count
 *   - Slice mainActions to max 5 entries
 *
 * @param {object} obj - Parsed perception (result of parsePerceptionJson)
 * @param {{ w: number, h: number }} screen - Viewport pixel dims
 * @param {number} margin - Clamp margin in pixels
 * @returns {object} same object (mutated)
 */
function normalizePerception(obj, screen, margin) {
  const { w: SW, h: SH } = screen;

  const pctToPx = (x, y) => {
    if (x <= 100 && y <= 100) {
      return {
        x: Math.round((x / 100) * SW),
        y: Math.round((y / 100) * SH),
      };
    }
    return { x, y };
  };

  const clamp = (v, hi) => Math.max(margin, Math.min(hi - margin, Math.round(v)));

  obj.navBar.tabs = obj.navBar.tabs
    .filter((t) => Number.isFinite(t.x) && Number.isFinite(t.y) && t.label)
    .map((t) => {
      const { x, y } = pctToPx(t.x, t.y);
      return { label: t.label, x: clamp(x, SW), y: clamp(y, SH) };
    });
  obj.navBar.hasNav = obj.navBar.tabs.length >= 2;
  if (!obj.navBar.hasNav) obj.navBar.tabs = [];

  obj.mainActions = obj.mainActions
    .slice(0, 5)
    .filter((a) => Number.isFinite(a.x) && Number.isFinite(a.y))
    .map((a) => {
      const { x, y } = pctToPx(a.x, a.y);
      return {
        description: a.description || "tap",
        x: clamp(x, SW),
        y: clamp(y, SH),
        priority: a.priority,
      };
    });

  return obj;
}

module.exports = {
  perceptionResponseSchema,
  parsePerceptionJson,
  normalizePerception,
  SCREEN_TYPES,
  DENSITIES,
  PRIORITIES,
};
