import { useMemo } from "react";
import { useJobStatus, usePublicReport } from "../../api/hooks";
import type {
  CrawlReport,
  CoverageRow,
  Finding,
  Recommendation,
  ReproTrail,
  ScoreBreakdown,
  ScreenCluster,
  ScreenRecord,
  Severity,
  V2DiligenceFlag,
  V2EvidencedFinding,
  V2Report,
  V2AnnotationsPayload,
} from "./types";
import { SEVERITY_ORDER, FINDING_TYPE_LABEL, SCREEN_TYPE_LABEL } from "./tokens";

import completeFixture from "./__fixtures__/complete.json";
import degradedFixture from "./__fixtures__/degraded.json";
import failedFixture from "./__fixtures__/failed.json";
import sampleFixture from "./__fixtures__/sample.json";

/**
 * Fixture lookup by job-id prefix — enables `/report/demo-complete-*` etc.
 * routes that bypass the real API in dev, for Playwright + design reviews.
 * The `sample` key also powers the public `/r/sample` outreach link.
 */
const FIXTURES: Record<string, CrawlReport> = {
  "demo-complete": completeFixture as unknown as CrawlReport,
  "demo-degraded": degradedFixture as unknown as CrawlReport,
  "demo-failed": failedFixture as unknown as CrawlReport,
  sample: sampleFixture as unknown as CrawlReport,
};

/**
 * Jobs that are always public — token not required, renders from fixture.
 * Keep this in sync with the FIXTURES map and the public router entry.
 */
export const PUBLIC_FIXTURE_JOB_IDS = new Set<string>(["sample"]);

export function isPublicFixtureJob(jobId: string | undefined | null): boolean {
  return !!jobId && PUBLIC_FIXTURE_JOB_IDS.has(jobId);
}

function matchFixture(jobId: string | undefined): CrawlReport | null {
  if (!jobId) return null;
  for (const prefix of Object.keys(FIXTURES)) {
    if (jobId.startsWith(prefix)) return FIXTURES[prefix];
  }
  return null;
}

/**
 * Normalize a raw job payload into a typed CrawlReport.
 * Tolerant of missing fields — returns null only if we have nothing at all.
 *
 * V2 fields (v2Report, v2Errors, annotations) live on the JOB, not the
 * report blob, so they are passed in separately by the caller.
 */
function normalizeReport(
  jobId: string,
  raw: unknown,
  jobLevel?: {
    v2Report?: unknown;
    v2Errors?: unknown;
    annotations?: unknown;
  }
): CrawlReport | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;

  const screens = Array.isArray(r.screens)
    ? (r.screens as ScreenRecord[])
    : [];
  const oracleFindings = Array.isArray(r.oracleFindings)
    ? (r.oracleFindings as Finding[])
    : Array.isArray(r.findings)
      ? (r.findings as Finding[])
      : [];

  const coverage =
    r.coverage && typeof r.coverage === "object"
      ? (r.coverage as Record<string, number>)
      : {};

  return {
    jobId,
    packageName: String(r.packageName ?? r.appName ?? ""),
    appName: r.appName ? String(r.appName) : undefined,
    completedAt: String(r.completedAt ?? new Date().toISOString()),
    status: (r.status as CrawlReport["status"]) ?? "complete",
    stopReason: String(r.stopReason ?? "unknown"),
    crawlQuality:
      (r.crawlQuality as CrawlReport["crawlQuality"]) ?? "minimal",
    engineVersion: r.engineVersion ? String(r.engineVersion) : undefined,
    model: r.model ? String(r.model) : undefined,
    screens,
    actionsTaken: Array.isArray(r.actionsTaken)
      ? (r.actionsTaken as CrawlReport["actionsTaken"])
      : [],
    graph:
      (r.graph as CrawlReport["graph"]) ?? {
        nodes: [],
        transitions: [],
        totalSteps: 0,
        uniqueStates: 0,
        parentMap: {},
      },
    stats:
      (r.stats as CrawlReport["stats"]) ?? {
        totalSteps: screens.length,
        uniqueStates: 0,
        totalTransitions: 0,
        recoveryStats: {},
        tokenUsage: {},
      },
    oracleFindings: oracleFindings.map((f, i) => ({
      ...f,
      id: f.id ?? `finding-${i}`,
    })),
    oracleFindingsByStep:
      (r.oracleFindingsByStep as CrawlReport["oracleFindingsByStep"]) ?? {},
    coverage,
    v2Coverage:
      (r.v2Coverage as CrawlReport["v2Coverage"]) ?? {
        stepsUsed: 0,
        uniqueScreens: 0,
        uniquePerStep: 0,
        uniquePerMinute: 0,
        stepsWastedOnRecovery: 0,
        costUSD: 0,
        cacheHitRate: 0,
      },
    flows: Array.isArray(r.flows) ? (r.flows as CrawlReport["flows"]) : [],
    metrics: (r.metrics as CrawlReport["metrics"]) ?? {},

    // V2 fields piped through from the JOB envelope.
    v2Report:
      jobLevel?.v2Report && typeof jobLevel.v2Report === "object"
        ? (jobLevel.v2Report as V2Report)
        : (r.v2Report && typeof r.v2Report === "object"
            ? (r.v2Report as V2Report)
            : null),
    v2Errors: Array.isArray(jobLevel?.v2Errors)
      ? (jobLevel!.v2Errors as string[])
      : Array.isArray(r.v2Errors)
        ? (r.v2Errors as string[])
        : null,
    annotations:
      jobLevel?.annotations && typeof jobLevel.annotations === "object"
        ? (jobLevel.annotations as V2AnnotationsPayload)
        : (r.annotations && typeof r.annotations === "object"
            ? (r.annotations as V2AnnotationsPayload)
            : null),
  };
}

export interface UseReportDataResult {
  report: CrawlReport | null;
  isLoading: boolean;
  error: string | null;
  rawStatus: string | null;
}

export interface UseReportDataOptions {
  /** If provided, fetch from the public (magic-link) endpoint instead. */
  publicToken?: string | null;
}

export function useReportData(
  jobId: string | undefined,
  options: UseReportDataOptions = {}
): UseReportDataResult {
  const fixture = matchFixture(jobId);
  const publicToken = options.publicToken ?? null;

  const authedQuery = useJobStatus(
    fixture || publicToken ? undefined : jobId
  );
  const publicQuery = usePublicReport(
    fixture ? undefined : jobId,
    publicToken
  );

  const job = publicToken ? publicQuery.data : authedQuery.data;
  const isLoading = publicToken ? publicQuery.isLoading : authedQuery.isLoading;
  const error = publicToken ? publicQuery.error : authedQuery.error;

  const report = useMemo<CrawlReport | null>(() => {
    if (fixture && jobId) return { ...fixture, jobId };
    if (!job) return null;
    // V2 fields live alongside `report` on the job envelope, not inside it.
    const jobAny = job as unknown as Record<string, unknown>;
    return normalizeReport(jobId ?? "unknown", job.report, {
      v2Report: jobAny.v2Report,
      v2Errors: jobAny.v2Errors,
      annotations: jobAny.annotations,
    });
  }, [fixture, job, jobId]);

  return {
    report,
    isLoading: fixture ? false : isLoading,
    error: error ? String(error) : null,
    rawStatus: job?.status ?? (fixture ? fixture.status : null),
  };
}

// ── Derivation selectors ────────────────────────────────────────────────────

function clamp(n: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, n));
}

export function computeScore(report: CrawlReport): ScoreBreakdown {
  const findings = report.oracleFindings;
  const crashes = findings.filter((f) => f.type === "crash").length;
  const anrs = findings.filter((f) => f.type === "anr").length;
  const a11y = findings.filter(
    (f) =>
      f.type === "missing_content_description" ||
      f.type === "small_tap_target"
  ).length;
  const slow = findings.filter((f) => f.type === "slow_transition").length;

  const stability = clamp(100 - (crashes * 28 + anrs * 18));
  const ux = clamp(100 - (a11y * 7 + slow * 6));

  const coverageVals = Object.values(report.coverage ?? {});
  const coverageAvg =
    coverageVals.length > 0
      ? Math.round(coverageVals.reduce((s, n) => s + n, 0) / coverageVals.length)
      : clamp(Math.round((report.v2Coverage.uniqueScreens / 20) * 100));

  const avgStepMs = report.metrics.stepTimings?.avgMs ?? 0;
  const performance = clamp(100 - Math.max(0, (avgStepMs - 2000) / 80));

  const overall = clamp(
    Math.round(stability * 0.35 + ux * 0.25 + coverageAvg * 0.25 + performance * 0.15)
  );

  return {
    overall,
    stability,
    ux,
    coverage: coverageAvg,
    performance: Math.round(performance),
  };
}

export function groupFindingsBySeverity(
  report: CrawlReport
): Record<Severity, Finding[]> {
  const grouped: Record<Severity, Finding[]> = {
    critical: [],
    high: [],
    medium: [],
    low: [],
  };
  for (const f of report.oracleFindings) {
    const sev = (f.severity ?? "low") as Severity;
    (grouped[sev] ??= []).push(f);
  }
  return grouped;
}

export function sortedFindings(report: CrawlReport): Finding[] {
  return [...report.oracleFindings].sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]
  );
}

export function clusterScreensByClassification(
  report: CrawlReport
): ScreenCluster[] {
  const byClass = new Map<string, ScreenRecord[]>();
  for (const s of report.screens) {
    const key = s.screenType || "unknown";
    const bucket = byClass.get(key) ?? [];
    bucket.push(s);
    byClass.set(key, bucket);
  }

  return Array.from(byClass.entries())
    .map(([classifier, screens]) => ({
      classifier: SCREEN_TYPE_LABEL[classifier] ?? classifier,
      coverPath: screens.find((s) => s.path)?.path ?? null,
      screens,
    }))
    .sort((a, b) => b.screens.length - a.screens.length);
}

function qualifierFor(score: number, what: string): string {
  if (score >= 85) return `${what} is production-ready`;
  if (score >= 70) return `${what} is solid`;
  if (score >= 50) return `${what} needs work`;
  return `${what} is blocking`;
}

export function buildVerdictSentence(
  report: CrawlReport,
  score: ScoreBreakdown
): { text: string; highlight: string } {
  const clusters = clusterScreensByClassification(report);
  const topAreas = clusters.slice(0, 2).map((c) => c.classifier.toLowerCase());
  const critical = report.oracleFindings.filter(
    (f) => f.severity === "critical"
  ).length;

  const strong = topAreas.length > 0 ? topAreas.join(" and ") : "the explored flows";

  if (critical > 0) {
    const highlight = `${critical} blocking defect${critical === 1 ? "" : "s"}`;
    return {
      text: `This build is production-ready for ${strong}, but checkout and critical paths have ${highlight}.`,
      highlight,
    };
  }

  if (score.overall >= 80) {
    return {
      text: `This build ships cleanly — ${strong} behave as expected with no critical issues surfaced.`,
      highlight: "ships cleanly",
    };
  }

  if (score.overall >= 60) {
    const qualifier = qualifierFor(score.overall, "The app");
    return {
      text: `${qualifier}. A handful of UX and accessibility issues are worth resolving before launch.`,
      highlight: "worth resolving",
    };
  }

  return {
    text: `This analysis did not complete cleanly — coverage is limited and stability is the primary risk.`,
    highlight: "coverage is limited",
  };
}

export function buildExecutiveSummary(
  report: CrawlReport,
  score: ScoreBreakdown
): string {
  const findings = report.oracleFindings;
  const critical = findings.filter((f) => f.severity === "critical").length;
  const high = findings.filter((f) => f.severity === "high").length;
  const med = findings.filter((f) => f.severity === "medium").length;
  const uniqueScreens = report.v2Coverage.uniqueScreens || report.screens.length;
  const elapsedMin =
    report.v2Coverage.uniquePerMinute > 0
      ? (uniqueScreens / report.v2Coverage.uniquePerMinute).toFixed(1)
      : "\u2013";
  const cost = `$${report.v2Coverage.costUSD.toFixed(2)}`;

  const coveragePct = score.coverage;
  const clusters = clusterScreensByClassification(report).slice(0, 3);
  const areas = clusters.map((c) => c.classifier.toLowerCase()).join(", ");

  const bugSentence = (() => {
    if (critical > 0)
      return `We surfaced ${critical} blocking ${critical === 1 ? "defect" : "defects"} — primarily in checkout and auth — that should ship-block the release.`;
    if (high > 0)
      return `Stability held, but ${high} high-severity ${high === 1 ? "issue" : "issues"} and ${med} medium-severity accessibility notes deserve attention.`;
    return `No critical issues were surfaced; the remaining ${med} medium-severity notes are mostly accessibility polish.`;
  })();

  return `ProdScope explored ${uniqueScreens} unique screens across ${areas || "the app"} in ${elapsedMin} minutes at a cost of ${cost}. Overall quality scored ${score.overall}/100 with coverage at ${coveragePct}%. ${bugSentence} A full per-finding reproduction, screen atlas, and recommended fixes follow below.`;
}

export function computeCoverageByArea(report: CrawlReport): CoverageRow[] {
  const entries = Object.entries(report.coverage ?? {});
  return entries
    .map(([area, percentage]) => ({
      area,
      covered: percentage,
      total: 100,
      percentage: Math.round(percentage),
    }))
    .sort((a, b) => b.percentage - a.percentage);
}

export function buildReproductionTrail(
  finding: Finding,
  report: CrawlReport
): ReproTrail {
  const step = finding.step ?? 0;
  const path = report.screens.filter((s) => s.step <= step).slice(-4);
  const screenshot =
    report.screens.find((s) => s.step === step)?.path ??
    path[path.length - 1]?.path ??
    null;

  return {
    finding,
    breadcrumbs: path.map((s) => ({
      label:
        SCREEN_TYPE_LABEL[s.screenType] ?? s.feature ?? s.activity.split(".").pop() ?? "Screen",
      activity: s.activity,
      step: s.step,
    })),
    screenshotPath: screenshot,
  };
}

export function buildRecommendations(report: CrawlReport): Recommendation[] {
  const out: Recommendation[] = [];
  const findings = report.oracleFindings;

  const crashes = findings.filter((f) => f.type === "crash");
  if (crashes.length > 0) {
    out.push({
      id: "rec-crash-fix",
      title: "Patch the crash in the checkout/auth paths",
      area: "stability",
      severity: "critical",
      effort: crashes.length > 2 ? "L" : "M",
      description: `${crashes.length} crash${crashes.length === 1 ? "" : "es"} detected in target app. Patch and add regression tests before shipping — users hit a hard dead-end and churn.`,
      linkedFindingIds: crashes.map((f) => f.id),
    });
  }

  const anrs = findings.filter((f) => f.type === "anr");
  if (anrs.length > 0) {
    out.push({
      id: "rec-anr",
      title: "Move heavy work off the main thread",
      area: "performance",
      severity: "high",
      effort: "M",
      description: `${anrs.length} ANR${anrs.length === 1 ? "" : "s"} detected. Large list loads and network calls should move to coroutines / workers; consider pagination or streaming.`,
      linkedFindingIds: anrs.map((f) => f.id),
    });
  }

  const a11y = findings.filter((f) => f.type === "missing_content_description");
  if (a11y.length > 0) {
    out.push({
      id: "rec-a11y-labels",
      title: "Add content descriptions to interactive elements",
      area: "accessibility",
      severity: "medium",
      effort: "S",
      description: `${a11y.length} screen${a11y.length === 1 ? "" : "s"} had interactive elements without labels. Apply \`contentDescription\` or semantic equivalents across icon buttons and image tiles.`,
      linkedFindingIds: a11y.map((f) => f.id),
    });
  }

  const taps = findings.filter((f) => f.type === "small_tap_target");
  if (taps.length > 0) {
    out.push({
      id: "rec-tap-targets",
      title: "Enlarge tap targets to 44dp minimum",
      area: "accessibility",
      severity: "low",
      effort: "XS",
      description: `Bump tap-target minimum size to satisfy WCAG 44 \u00D7 44dp. Most issues are clustered in list/grid layouts — a single padding/hitSlop pass usually resolves it.`,
      linkedFindingIds: taps.map((f) => f.id),
    });
  }

  const slow = findings.filter((f) => f.type === "slow_transition");
  if (slow.length > 0) {
    out.push({
      id: "rec-slow",
      title: "Reduce cold-load latency on heavy screens",
      area: "performance",
      severity: "low",
      effort: "M",
      description: `${slow.length} transition${slow.length === 1 ? "" : "s"} exceeded the 12s responsiveness budget. Consider skeletons, prefetching, or cache warming.`,
      linkedFindingIds: slow.map((f) => f.id),
    });
  }

  const coverageVals = Object.values(report.coverage ?? {});
  const lowArea = Object.entries(report.coverage ?? {}).find(
    ([, v]) => v < 40
  );
  if (coverageVals.length > 0 && lowArea) {
    out.push({
      id: "rec-coverage",
      title: `Improve coverage of the ${lowArea[0]} area`,
      area: "navigation",
      severity: "medium",
      effort: "S",
      description: `Only ${lowArea[1]}% of the ${lowArea[0]} surface was reachable. Add entry points from the main nav or ensure auth flows don't block access.`,
    });
  }

  return out;
}

/**
 * Stringify oracle type for user-facing text.
 */
export function findingTypeLabel(type: string): string {
  return FINDING_TYPE_LABEL[type] ?? type.replace(/_/g, " ");
}

/**
 * Utility: total duration of a crawl in human-readable form.
 */
export function humanizeDuration(report: CrawlReport): string {
  const steps = report.v2Coverage.stepsUsed || report.stats.totalSteps || 0;
  const perMin = report.v2Coverage.uniquePerMinute || 0;
  if (perMin <= 0 || steps <= 0) return "\u2014";
  const mins = steps / Math.max(1, perMin);
  if (mins < 1) return `${Math.round(mins * 60)}s`;
  return `${mins.toFixed(1)} min`;
}

// \u2500\u2500 V2 selectors \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

/**
 * Diligence flags marked as strengths \u2014 areas where the app demonstrates
 * intentional craft, with citeable evidence and a founder question. The
 * BALANCE RULE in brain/report-prompt-v2.js requires at least one per
 * report, but we still defensively return [] on empty.
 */
export function strengthFlags(report: CrawlReport): V2DiligenceFlag[] {
  const flags = report.v2Report?.diligence_flags ?? [];
  return flags.filter((f) => f.severity === "strength");
}

/**
 * Diligence flags marked as concern OR watch_item \u2014 the issues the report
 * raises. Strengths are excluded; they have their own section.
 */
export function concernFlags(report: CrawlReport): V2DiligenceFlag[] {
  const flags = report.v2Report?.diligence_flags ?? [];
  return flags.filter(
    (f) => f.severity === "concern" || f.severity === "watch_item"
  );
}

/**
 * Did the V2 pipeline produce a useful, populated report? Reports without
 * V2 fall back to the V1 deterministic renderer for the visible sections.
 */
export function hasUsableV2(report: CrawlReport | null): boolean {
  if (!report || !report.v2Report) return false;
  const v2 = report.v2Report;
  return (
    (v2.verdict?.claims?.length ?? 0) > 0 &&
    (v2.diligence_flags?.length ?? 0) > 0
  );
}
