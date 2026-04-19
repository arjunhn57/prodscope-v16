import type { Tier } from "../../stores/auth";

export type BillingCycle = "monthly" | "annual";

export interface TierPlan {
  tier: Tier;
  name: string;
  tagline: string;
  monthlyUsd: number;
  annualUsd: number;
  highlighted: boolean;
  badge?: string;
  ctaPrimary: string;
  bullets: string[];
}

export const TIERS: readonly TierPlan[] = [
  {
    tier: "free",
    name: "Free",
    tagline: "Kick the tyres. No card.",
    monthlyUsd: 0,
    annualUsd: 0,
    highlighted: false,
    ctaPrimary: "Get started",
    bullets: [
      "3 analyses per month",
      "40 steps per analysis",
      "Top 3 findings + 3 screenshots",
      "7-day report retention",
      "Live Analysis Theater",
    ],
  },
  {
    tier: "pro",
    name: "Pro",
    tagline: "For developers who ship weekly.",
    monthlyUsd: 16,
    annualUsd: 154,
    highlighted: true,
    badge: "Most popular",
    ctaPrimary: "Start 14-day Pro trial",
    bullets: [
      "25 analyses per month",
      "60 steps per analysis",
      "Full findings + coverage breakdown",
      "Interactive App Map + exports",
      "30-day report retention",
    ],
  },
  {
    tier: "enterprise",
    name: "Enterprise",
    tagline: "For teams shipping revenue-critical apps.",
    monthlyUsd: 100,
    annualUsd: 960,
    highlighted: false,
    ctaPrimary: "Start 14-day Enterprise trial",
    bullets: [
      "Unlimited analyses",
      "80 steps + focus-mode runs",
      "Priority queue + API access",
      "SSO, SOC 2 roadmap, custom contracts",
      "Unbounded retention + comparison",
    ],
  },
];

/** Annual discount as shown to the user. Derived from the monthly/annual numbers above. */
export const ANNUAL_SAVINGS_PCT = 20;

export function tierByName(name: Tier): TierPlan {
  const plan = TIERS.find((t) => t.tier === name);
  if (!plan) throw new Error(`Unknown tier: ${name}`);
  return plan;
}

/**
 * Feature comparison rows grouped by category. Driven by the matrix in the
 * plan — used by both the authenticated pricing page's comparison table and
 * (eventually) any parity copy on the marketing page.
 */
export type ComparisonCell = boolean | string;

export interface ComparisonRow {
  label: string;
  free: ComparisonCell;
  pro: ComparisonCell;
  enterprise: ComparisonCell;
}

export interface ComparisonCategory {
  category: string;
  rows: ComparisonRow[];
}

export const FEATURE_ROWS: readonly ComparisonCategory[] = [
  {
    category: "Analysis",
    rows: [
      { label: "Analyses per month", free: "3", pro: "25", enterprise: "Unlimited" },
      { label: "Max steps per analysis", free: "40", pro: "60", enterprise: "80" },
      { label: "Priority analysis queue", free: false, pro: false, enterprise: true },
      { label: "Focus-mode runs", free: false, pro: false, enterprise: true },
      { label: "API access (CI/CD)", free: false, pro: false, enterprise: true },
    ],
  },
  {
    category: "Reports",
    rows: [
      { label: "Overall score", free: true, pro: true, enterprise: true },
      { label: "Executive summary", free: true, pro: true, enterprise: true },
      { label: "Findings list", free: "Top 3", pro: "Full", enterprise: "Full" },
      { label: "Quick wins + recommendations", free: false, pro: true, enterprise: true },
      { label: "PDF / JSON / CSV export", free: false, pro: true, enterprise: true },
    ],
  },
  {
    category: "Visualization",
    rows: [
      { label: "Live Analysis Theater", free: true, pro: true, enterprise: true },
      { label: "Screenshots", free: "3 per report", pro: "Full", enterprise: "Full" },
      { label: "Interactive App Map", free: false, pro: true, enterprise: true },
      { label: "Coverage breakdown", free: false, pro: true, enterprise: true },
      { label: "Auth FSM diagram", free: false, pro: true, enterprise: true },
    ],
  },
  {
    category: "History & analysis",
    rows: [
      { label: "Report retention", free: "7 days", pro: "30 days", enterprise: "Unbounded" },
      { label: "History depth", free: "Last 5", pro: "Last 50", enterprise: "Full history" },
      { label: "Comparison view", free: false, pro: true, enterprise: true },
      { label: "SSO + custom contracts", free: false, pro: false, enterprise: true },
    ],
  },
];

export interface FaqItem {
  q: string;
  a: string;
}

export const PRICING_FAQS: readonly FaqItem[] = [
  {
    q: "What's in the free tier, really?",
    a: "Three full analyses per month, the Live Analysis Theater, top-3 findings, and 7-day retention. No credit card. Enough to form an honest opinion.",
  },
  {
    q: "How does the 14-day trial work?",
    a: "Click the trial CTA and the plan activates immediately — no credit card, no commitment. At the end of 14 days you drop back to Free automatically. You can switch tiers at any time inside ProdScope.",
  },
  {
    q: "What happens to my analyses if I cancel?",
    a: "Existing reports remain accessible for your current tier's retention window. Free-tier retention is 7 days, Pro is 30, Enterprise is unbounded.",
  },
  {
    q: "Can I switch tiers mid-cycle?",
    a: "Yes. Upgrades take effect immediately. Downgrades take effect at the end of the current billing period so you don't lose paid-for capacity.",
  },
  {
    q: "Is my data used to train AI models?",
    a: "Uploaded APKs are deleted after analysis. Aggregated, anonymised crash and flow signal may improve our models — you can opt out from Settings at any time.",
  },
  {
    q: "Annual vs monthly billing?",
    a: "Annual billing saves ~20% versus paying monthly — 2.4 months free. You can switch at renewal.",
  },
  {
    q: "Do you offer Enterprise contracts and SSO?",
    a: "Yes. Enterprise includes SSO, a custom MSA, priority support, and a named contact. Reach out and we'll tailor a contract.",
  },
  {
    q: "How do I get help?",
    a: "Email arjun@prodscope.io — every ticket is answered by a human within 1 business day while we're pre-scale.",
  },
];
