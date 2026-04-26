import type { Severity } from "./types";

/**
 * Editorial design tokens for the Report Page.
 *
 * These extend the global `index.css` palette with surface recipes, gradient
 * accents, and severity colors that are shared across report components.
 * Keep pure tokens — no component logic.
 */

/**
 * Phase B5 (2026-04-26): the report uses a dual-token color system.
 *
 *  - **accent** (magenta, #D62B4D) is the BRAND accent. Matches the
 *    color the annotator already paints on every screenshot box
 *    (output/annotator/style.js:ACCENT). Use for finding-coded UI:
 *    severity dots, recommended-fix borders, hero halo, section
 *    markers inside report context.
 *
 *  - **accentSupporting** (purple, #6C47FF) is the SUPPORTING accent.
 *    Reserved for gradient surfaces and large decorative areas where
 *    pure magenta would feel aggressive. Anchors the cool side of the
 *    purple→magenta gradient.
 *
 *  - **accentDecorative** (lavender, #8A6CFF) is the lightest cool
 *    stop in the gradient. Decorative only — never on text/badges.
 *
 * Severity colors anchor on this dual scale: critical and high lean
 * magenta, medium and low lean neutral. Strength has its own green
 * palette (STRENGTH_PALETTE below).
 */
export const REPORT_GRADIENTS = {
  hero: "linear-gradient(120deg, #8A6CFF 0%, #6C47FF 55%, #D62B4D 100%)",
  auroraTile:
    "linear-gradient(180deg, rgba(255,255,255,0.98) 0%, rgba(239,235,255,0.42) 100%)",
  scoreTrack: "linear-gradient(135deg, #6C47FF 0%, #8A6CFF 50%, #D62B4D 100%)",
  tintedDivider:
    "linear-gradient(90deg, rgba(226,232,240,0) 0%, rgba(214,43,77,0.20) 50%, rgba(226,232,240,0) 100%)",
  criticalChipBg: "linear-gradient(120deg, #FFE4EA 0%, #FECDD3 100%)",
  editorialHeadline:
    "linear-gradient(120deg, #1E1B4B 0%, #4C1D95 32%, #6C47FF 58%, #D62B4D 100%)",
} as const;

/**
 * Hex equivalents of the core CSS variables — needed when a prop accepts only
 * a literal color (e.g. SVG `stroke`, Lucide `color=`, inline SVG `fill`).
 * Prefer `var(--color-report-accent)` etc. in `className` / `style` where possible.
 *
 * Phase B5: `accent` flipped from purple → magenta to match the
 * annotator. `accentSupporting` (the previous primary purple) and
 * `accentDecorative` (lavender) added so gradient anchors and
 * supporting visuals stay codified.
 */
export const REPORT_COLORS = {
  accent: "#D62B4D",
  accentRing: "rgba(214, 43, 77, 0.25)",
  accentSupporting: "#6C47FF",
  accentSupportingRing: "rgba(108, 71, 255, 0.22)",
  accentDecorative: "#8A6CFF",
  textPrimary: "#0F172A",
  textMuted: "#475569",
} as const;

export const REPORT_SURFACES = {
  pageBg: "#FAFAFA",
  card: "#FFFFFF",
  cardMuted: "#F8FAFC",
  divider: "#E2E8F0",
  borderDefault: "1px solid #E2E8F0",
  borderAccent: "1px solid rgba(108,71,255,0.28)",
  shadowSoft: "0 1px 3px rgba(15,23,42,0.04), 0 8px 24px -12px rgba(15,23,42,0.08)",
  shadowLift: "0 2px 6px rgba(15,23,42,0.06), 0 20px 48px -20px rgba(15,23,42,0.14)",
  radiusLg: 20,
  radiusMd: 16,
  radiusSm: 12,
} as const;

/**
 * Canonical tinted-glass panel recipes. Use these instead of duplicating the
 * `{ background: auroraTile, border: ..., boxShadow: ... }` trio inline.
 *
 * - `TILE_STYLE`: default tile — subtle 22% accent border, neutral drop shadow.
 *   Use for metric tiles, inner sections, dashboard cards.
 * - `ACCENT_PANEL_STYLE`: emphasized panel — 28% accent border, tinted glow.
 *   Use for hero quota meters, featured cards, CTA wells.
 */
export const TILE_STYLE = {
  background: REPORT_GRADIENTS.auroraTile,
  border: "1px solid rgba(108,71,255,0.22)",
  boxShadow:
    "0 1px 3px rgba(15,23,42,0.04), 0 16px 36px -20px rgba(15,23,42,0.12)",
} as const;

export const ACCENT_PANEL_STYLE = {
  background: REPORT_GRADIENTS.auroraTile,
  border: "1px solid rgba(108,71,255,0.28)",
  boxShadow:
    "0 1px 3px rgba(15,23,42,0.04), 0 20px 40px -24px rgba(108,71,255,0.22)",
} as const;

export const SEVERITY_COLOR: Record<Severity, { fg: string; bg: string; dot: string; ring: string }> = {
  critical: {
    fg: "#B91C1C",
    bg: "#FEF2F2",
    dot: "#EF4444",
    ring: "rgba(239,68,68,0.3)",
  },
  high: {
    fg: "#B45309",
    bg: "#FFFBEB",
    dot: "#F59E0B",
    ring: "rgba(245,158,11,0.3)",
  },
  medium: {
    fg: "#A16207",
    bg: "#FEFCE8",
    dot: "#FACC15",
    ring: "rgba(250,204,21,0.35)",
  },
  low: {
    fg: "#0F766E",
    bg: "#F0FDFA",
    dot: "#14B8A6",
    ring: "rgba(20,184,166,0.28)",
  },
};

export const SEVERITY_ORDER: Record<Severity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

export const FINDING_TYPE_LABEL: Record<string, string> = {
  crash: "Crash",
  anr: "App Not Responding",
  missing_content_description: "Missing accessibility label",
  small_tap_target: "Tap target too small",
  slow_transition: "Slow transition",
};

export const FINDING_TYPE_EXPLAINER: Record<string, string> = {
  crash: "A runtime exception terminated the app mid-session — users see a blank screen or Android's \u201CApp has stopped\u201D dialog.",
  anr: "The main thread was blocked long enough to trigger Android's ANR dialog. Users are asked whether to wait or close.",
  missing_content_description:
    "Interactive elements lack screen-reader labels. Users on TalkBack or VoiceOver cannot discover their function.",
  small_tap_target:
    "Tap targets below the 44 \u00D7 44 dp WCAG minimum are hard to hit on mobile and cause mis-taps.",
  slow_transition: "Screen transitions exceeded the 12s responsiveness budget, making the app feel unresponsive.",
};

export const SCREEN_TYPE_LABEL: Record<string, string> = {
  auth: "Auth",
  feed: "Feed",
  detail: "Detail",
  search: "Search",
  checkout: "Checkout",
  settings: "Settings",
  onboarding: "Onboarding",
  empty: "Empty state",
  modal: "Modal",
  list: "List",
  form: "Form",
  other: "Other",
  unknown: "Unclassified",
};

export const EDITORIAL_EASE: [number, number, number, number] = [0.22, 0.61, 0.36, 1];

export const SECTION_IDS = {
  masthead: "report-masthead",
  verdict: "report-verdict",
  hero: "report-hero",
  signals: "report-signals",
  summary: "report-summary",
  keyNumbers: "report-key-numbers",
  strengths: "report-strengths",
  findings: "report-findings",
  atlas: "report-atlas",
  coverage: "report-coverage",
  journey: "report-journey",
  timeline: "report-timeline",
  recommendations: "report-recommendations",
  footer: "report-footer",
} as const;

/**
 * Strength palette — green/teal balance to the magenta-leaning severity scale.
 * Mirrors the `STRENGTH_HALO = "#16A34A"` value in AnnotatedScreenshot.tsx so
 * the badge on the screenshot matches the badge on the section card.
 */
export const STRENGTH_PALETTE = {
  fg: "#0F766E",
  bg: "#F0FDFA",
  dot: "#16A34A",
  ring: "rgba(22,163,74,0.32)",
  border: "1px solid rgba(22,163,74,0.22)",
  bgGradient:
    "linear-gradient(180deg, rgba(255,255,255,0.98) 0%, rgba(220,252,231,0.45) 100%)",
} as const;

export type SectionId = (typeof SECTION_IDS)[keyof typeof SECTION_IDS];
