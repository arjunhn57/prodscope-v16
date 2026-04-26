import { useMemo } from "react";
import { useJobStatus, usePublicReport } from "../../api/hooks";
import { API_BASE } from "../../lib/constants";
import type {
  CrawlReport,
  CoverageRow,
  ExecutiveSummary,
  Finding,
  Recommendation,
  ReproTrail,
  ScoreBreakdown,
  ScreenCluster,
  ScreenRecord,
  Severity,
  V2DiligenceFlag,
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
/**
 * Resolve a raw screenshot path to a URL the browser can fetch.
 *
 * Backend stores the absolute filesystem path on the VM (e.g.
 * "/tmp/screenshots-<jobId>/step-1.png"). The browser cannot load that;
 * the served URL is "/api/v1/job-screenshot/<jobId>/<filename>".
 *
 * Already-absolute http(s) URLs are returned unchanged.
 */
function resolveScreenshotUrl(
  rawPath: string | null | undefined,
  jobId: string
): string | null {
  if (!rawPath) return null;
  if (/^https?:\/\//i.test(rawPath)) return rawPath;
  // Last segment is the filename — handles both "/tmp/screenshots-x/step-1.png"
  // and "step-1.png" alone.
  const filename = rawPath.split(/[\\/]/).pop() ?? "";
  if (!filename) return null;
  const base = API_BASE.replace(/\/+$/, "");
  return `${base}/job-screenshot/${encodeURIComponent(jobId)}/${encodeURIComponent(filename)}`;
}

/**
 * Synthesize a screens array from a list of screenshot paths when the V1
 * deterministic report didn't surface one (e.g. when V1 was suppressed
 * because triage coverage was low). Step number is extracted from the
 * filename pattern "step-N.png".
 */
function synthesizeScreensFromPaths(
  jobId: string,
  paths: string[]
): ScreenRecord[] {
  const out: ScreenRecord[] = [];
  for (const p of paths || []) {
    if (typeof p !== "string") continue;
    const filename = p.split(/[\\/]/).pop() ?? "";
    const match = filename.match(/^step-(\d+)\.png$/i);
    if (!match) continue;
    const step = Number(match[1]);
    const url = resolveScreenshotUrl(p, jobId);
    if (!url) continue;
    out.push({
      index: step,
      step,
      path: url,
      activity: "",
      timestamp: null,
      screenType: "unknown",
      feature: "",
      fuzzyFp: "",
    });
  }
  return out.sort((a, b) => a.step - b.step);
}

function normalizeReport(
  jobId: string,
  raw: unknown,
  jobLevel?: {
    v2Report?: unknown;
    v2Errors?: unknown;
    annotations?: unknown;
    executiveSummary?: unknown;
    screenshots?: unknown;
    appPackage?: unknown;
    appName?: unknown;
    launcherActivity?: unknown;
  }
): CrawlReport | null {
  // The backend serializes job.report as a JSON STRING in some paths
  // (the SQLite blob round-trip stringifies the V1 report on store).
  // Parse it back to an object before normalizing — bailing here
  // produced "Report unavailable" even on otherwise-good runs.
  let parsed: unknown = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch {
      // If it's an unparseable string but jobLevel V2 data is present,
      // we can still render the V2-only sections — synthesize a minimal
      // report shell.
      parsed = {};
    }
  }
  if (!parsed || typeof parsed !== "object") {
    // Last resort: if V2 fields exist on the job envelope we still want
    // to render. Build a near-empty report shell so the V2 sections can
    // hydrate from jobLevel.
    if (jobLevel?.v2Report) {
      parsed = {};
    } else {
      return null;
    }
  }
  const r = parsed as Record<string, unknown>;

  // Pull screens from V1 report if present; otherwise synthesize from the
  // screenshot paths exposed at the job level. Either way, normalize each
  // screen's `path` to a URL the browser can actually fetch (the raw VM
  // filesystem path won't load).
  const rawScreens = Array.isArray(r.screens)
    ? (r.screens as ScreenRecord[])
    : [];
  const synthesized =
    rawScreens.length === 0 && Array.isArray(jobLevel?.screenshots)
      ? synthesizeScreensFromPaths(jobId, jobLevel!.screenshots as string[])
      : [];
  const screens: ScreenRecord[] =
    rawScreens.length > 0
      ? rawScreens.map((s) => ({
          ...s,
          path: resolveScreenshotUrl(s.path, jobId),
        }))
      : synthesized;
  const oracleFindings = Array.isArray(r.oracleFindings)
    ? (r.oracleFindings as Finding[])
    : Array.isArray(r.findings)
      ? (r.findings as Finding[])
      : [];

  const coverage =
    r.coverage && typeof r.coverage === "object"
      ? (r.coverage as Record<string, number>)
      : {};

  // App identity: prefer the job-level fields (populated from manifest
  // parser, present even when V1 deterministic report is suppressed)
  // and fall back to whatever V1 report contains.
  const jobAppPackage =
    typeof jobLevel?.appPackage === "string" && jobLevel.appPackage.length > 0
      ? jobLevel.appPackage
      : null;
  const jobAppName =
    typeof jobLevel?.appName === "string" && jobLevel.appName.length > 0
      ? jobLevel.appName
      : null;
  const resolvedPackageName =
    jobAppPackage ?? (r.packageName ? String(r.packageName) : "");
  const resolvedAppName =
    jobAppName ?? (r.appName ? String(r.appName) : undefined);

  return {
    jobId,
    packageName: resolvedPackageName,
    appName: resolvedAppName,
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
    executiveSummary:
      jobLevel?.executiveSummary && typeof jobLevel.executiveSummary === "object"
        ? (jobLevel.executiveSummary as ExecutiveSummary)
        : (r.executiveSummary && typeof r.executiveSummary === "object"
            ? (r.executiveSummary as ExecutiveSummary)
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
      executiveSummary: jobAny.executiveSummary,
      screenshots: jobAny.screenshots,
      appPackage: jobAny.appPackage,
      appName: jobAny.appName,
      launcherActivity: jobAny.launcherActivity,
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

/**
 * Defensive cast — turns NaN/undefined into a finite fallback so downstream
 * arithmetic never produces NaN. The score breakdown was rendering "NaN"
 * in the radial when synthesized screens had no metrics attached.
 */
function safeNum(v: unknown, fallback = 0): number {
  if (typeof v !== "number" || !Number.isFinite(v)) return fallback;
  return v;
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

  // Coverage:
  //   - V1 path: average of report.coverage map (per-area %)
  //   - V2 fallback: derive from V2 coverage_summary if present
  //   - last resort: scale from uniqueScreens (0..20+)
  const coverageVals = Object.values(report.coverage ?? {})
    .map((v) => safeNum(v))
    .filter((v) => v > 0);
  let coverageAvg: number;
  if (coverageVals.length > 0) {
    coverageAvg = Math.round(
      coverageVals.reduce((s, n) => s + n, 0) / coverageVals.length
    );
  } else if (report.v2Report?.coverage_summary) {
    const reached = safeNum(report.v2Report.coverage_summary.screens_reached);
    const blocked = report.v2Report.coverage_summary.screens_attempted_blocked?.length ?? 0;
    const notAttempted = report.v2Report.coverage_summary.areas_not_attempted?.length ?? 0;
    const total = reached + blocked + notAttempted;
    coverageAvg = total > 0 ? Math.round((reached / total) * 100) : safeNum(reached) > 0 ? 60 : 0;
  } else {
    const uniqueScreens = safeNum(report.v2Coverage?.uniqueScreens) || report.screens.length;
    coverageAvg = clamp(Math.round((uniqueScreens / 20) * 100));
  }
  coverageAvg = clamp(safeNum(coverageAvg));

  const avgStepMs = safeNum(report.metrics?.stepTimings?.avgMs);
  const performance = clamp(100 - Math.max(0, (avgStepMs - 2000) / 80));

  const overall = clamp(
    Math.round(stability * 0.35 + ux * 0.25 + coverageAvg * 0.25 + performance * 0.15)
  );

  return {
    overall: safeNum(overall),
    stability: safeNum(stability),
    ux: safeNum(ux),
    coverage: safeNum(coverageAvg),
    performance: safeNum(Math.round(performance)),
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

/**
 * V2 is "usable" for narrative when the synthesizer produced both a
 * verdict (3 claims) and at least one diligence flag. Below that bar
 * we fall back to V1's deterministic builders.
 */
export function usableV2(report: CrawlReport | null | undefined): boolean {
  if (!report || !report.v2Report) return false;
  const v2 = report.v2Report;
  return (
    (v2.verdict?.claims?.length ?? 0) >= 1 &&
    (v2.diligence_flags?.length ?? 0) >= 1
  );
}

/**
 * Pick a short highlight phrase from a longer V2 claim. Heuristic:
 * grab the first noun-phrase-shaped fragment of 2-6 words. Fallback
 * to the first 6 words. Used to gradient-highlight a portion of the
 * hero verdict.
 */
function pickClaimHighlight(claim: string): string {
  const cleaned = claim.replace(/\s+/g, " ").trim();
  // Prefer phrases like "blank screen", "12 critical bugs", etc.
  const phraseMatch = cleaned.match(
    /\b(non-functional|blank|inconsistent|missing|unclear|polished|consistent|smooth|broken|critical|delayed|unresponsive|empty)\s+\w+(?:\s+\w+)?\b/i
  );
  if (phraseMatch) return phraseMatch[0];
  return cleaned.split(" ").slice(0, 6).join(" ");
}

export function buildVerdictSentence(
  report: CrawlReport,
  score: ScoreBreakdown
): { text: string; highlight: string } {
  // V2 path: when V2 has a populated verdict, use its first claim as the
  // hero. Pick a high-impact phrase to highlight via gradient.
  if (usableV2(report)) {
    const firstClaim = report.v2Report!.verdict.claims[0]?.claim ?? "";
    if (firstClaim.length > 20) {
      return {
        text: firstClaim,
        highlight: pickClaimHighlight(firstClaim),
      };
    }
  }

  // V1 fallback (pre-V2 reports + edge cases).
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
  const uniqueScreens = safeNum(report.v2Coverage?.uniqueScreens) || report.screens.length;
  const upm = safeNum(report.v2Coverage?.uniquePerMinute);
  const elapsedMin = upm > 0 ? (uniqueScreens / upm).toFixed(1) : "\u2013";
  const cost = `$${safeNum(report.v2Coverage?.costUSD).toFixed(2)}`;

  // V2 narrative path takes precedence when populated.
  if (usableV2(report)) {
    const v2 = report.v2Report!;
    const claim2 = v2.verdict.claims[1]?.claim ?? "";
    const claim3 = v2.verdict.claims[2]?.claim ?? "";
    const concernCount = v2.diligence_flags.filter(
      (f) => f.severity === "concern" || f.severity === "watch_item"
    ).length;
    const strengthCount = v2.diligence_flags.filter((f) => f.severity === "strength").length;
    const criticalBugs = v2.critical_bugs?.length ?? 0;
    const uxIssues = v2.ux_issues?.length ?? 0;
    const screensReached = safeNum(v2.coverage_summary?.screens_reached, report.screens.length);
    const costUsd = safeNum(report.v2Coverage?.costUSD);
    const costStr = costUsd > 0 ? ` at a cost of $${costUsd.toFixed(2)}` : "";

    const totalIssues = criticalBugs + uxIssues + concernCount;
    const issueLine =
      totalIssues > 0
        ? `${totalIssues} ${totalIssues === 1 ? "concern" : "concerns"} surfaced (${criticalBugs} critical, ${uxIssues} UX, ${concernCount} flagged)`
        : `No material concerns surfaced in the explored surface`;
    const strengthLine =
      strengthCount > 0
        ? `${strengthCount} ${strengthCount === 1 ? "area" : "areas"} of citeable craft`
        : "no strengths surfaced";

    const claimsLine =
      claim2 && claim3 ? `${claim2} ${claim3}` : claim2 || claim3 || "";

    return `ProdScope reached ${screensReached} unique screens${costStr}. ${issueLine}, with ${strengthLine}. ${claimsLine} Full per-finding evidence, founder questions, and the screen atlas follow below.`;
  }

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

function v2SeverityToRecommendationSeverity(severity: string): Severity {
  switch (severity) {
    case "concern":
    case "critical":
      return "critical";
    case "high":
      return "high";
    case "watch_item":
    case "medium":
      return "medium";
    default:
      return "low";
  }
}

function v2RecommendationArea(claim: string): Recommendation["area"] {
  const c = claim.toLowerCase();
  if (/(crash|anr|background|init|launch)/.test(c)) return "stability";
  if (/(a11y|accessibility|contrast|screen reader|wcag|focus)/.test(c))
    return "accessibility";
  if (/(slow|latency|spinner|jank|performance|cold start)/.test(c))
    return "performance";
  if (/(nav|tab|drawer|onboarding|sign[\s-]?up|sign[\s-]?in|consent)/.test(c))
    return "navigation";
  return "ux";
}

export function buildRecommendations(report: CrawlReport): Recommendation[] {
  // V2 fallback: when V1 deterministic findings are empty but V2 produced
  // a populated diligence report, derive recommendations from V2's
  // concern/watch_item flags + critical_bugs. Each V2 flag's
  // founder_question becomes the description body.
  if (report.oracleFindings.length === 0 && usableV2(report)) {
    const v2 = report.v2Report!;
    const out: Recommendation[] = [];
    concernFlags(report).forEach((f, i) => {
      out.push({
        id: `v2-rec-flag-${i}`,
        title: f.claim.split(/[.!?]/)[0]?.slice(0, 80) || f.claim.slice(0, 80),
        area: v2RecommendationArea(f.claim),
        severity: v2SeverityToRecommendationSeverity(f.severity),
        effort: f.severity === "concern" ? "M" : "S",
        description: f.severity_rationale || f.founder_question,
      });
    });
    (v2.critical_bugs ?? []).forEach((b, i) => {
      out.push({
        id: `v2-rec-bug-${i}`,
        title: b.title || b.claim.slice(0, 80),
        area: v2RecommendationArea(b.claim),
        severity: v2SeverityToRecommendationSeverity(b.severity),
        effort: "L",
        description: b.claim,
      });
    });
    return out;
  }

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

// \u2500\u2500 Display findings \u2014 unify V1 + V2 for the CriticalFindings section \u2500\u2500\u2500\u2500\u2500\u2500\u2500

/**
 * The shape rendered by `CriticalFindings.tsx`. Extends V1's `Finding`
 * with optional V2-only fields (founder_question + claim text from V2's
 * EvidencedFinding/DiligenceFlag) so the same card layout can render
 * either source.
 */
export interface DisplayFinding extends Finding {
  /** When present, render the "Ask the founder \u2014" callout below the body. */
  founderQuestion?: string;
  /** Evidence screen IDs from V2 (when V2-sourced). */
  evidenceScreenIds?: string[];
  /** True when this came from V2 critical_bugs / ux_issues / flag (no V1 finding type). */
  fromV2?: boolean;
  /** When V2-sourced, the original verbose claim text. */
  claim?: string;
  /** Phase B4: WHY this finding matters \u2014 user impact paragraph. V2 only. */
  explanationMd?: string;
  /** Phase B4: concrete remediation step. V2 only. */
  recommendationMd?: string;
}

const V2_SEVERITY_TO_V1: Record<string, Severity> = {
  critical: "critical",
  high: "high",
  medium: "medium",
  low: "low",
  // Diligence-flag severities map to display severity:
  concern: "high",
  watch_item: "medium",
  strength: "low", // unused \u2014 strengths don't enter displayFindings
};

function v2FindingToDisplay(
  source: "critical_bug" | "ux_issue" | "concern_flag",
  index: number,
  title: string,
  claim: string,
  severity: string,
  evidenceScreenIds: string[],
  founderQuestion?: string,
  explanationMd?: string,
  recommendationMd?: string
): DisplayFinding {
  const firstEvidence = evidenceScreenIds[0] ?? "";
  const stepMatch = firstEvidence.match(/^screen_(\d+)$/);
  const step = stepMatch ? Number(stepMatch[1]) : 0;
  return {
    id: `v2-${source}-${index}`,
    type:
      source === "critical_bug"
        ? "crash"
        : source === "ux_issue"
          ? "ux_issue"
          : "diligence_flag",
    severity: V2_SEVERITY_TO_V1[severity] ?? "medium",
    detail: title || claim,
    step,
    founderQuestion,
    evidenceScreenIds,
    fromV2: true,
    claim,
    explanationMd,
    recommendationMd,
  };
}

/**
 * Unified findings list for the CriticalFindings section.
 *
 * - If V1's `oracleFindings` is non-empty, return it (existing behavior).
 * - Else, derive from V2: critical_bugs + ux_issues + concern/watch_item flags.
 *
 * V2-sourced items carry their `founder_question` so the card can render
 * the "Ask the founder \u2014" callout \u2014 the deliverable's killer feature.
 */
export function displayFindings(report: CrawlReport): DisplayFinding[] {
  if (report.oracleFindings.length > 0) {
    return [...report.oracleFindings].sort(
      (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]
    );
  }

  if (!usableV2(report)) return [];

  const v2 = report.v2Report!;
  const out: DisplayFinding[] = [];

  (v2.critical_bugs ?? []).forEach((b, i) =>
    out.push(
      v2FindingToDisplay(
        "critical_bug",
        i,
        b.title,
        b.claim,
        b.severity,
        b.evidence_screen_ids,
        undefined,
        b.explanation_md,
        b.recommendation_md
      )
    )
  );

  (v2.ux_issues ?? []).forEach((u, i) =>
    out.push(
      v2FindingToDisplay(
        "ux_issue",
        i,
        u.title,
        u.claim,
        u.severity,
        u.evidence_screen_ids,
        undefined,
        u.explanation_md,
        u.recommendation_md
      )
    )
  );

  // Concerns + watch_items as findings (their founder_question is the
  // killer field \u2014 must surface).
  concernFlags(report).forEach((f, i) =>
    out.push(
      v2FindingToDisplay(
        "concern_flag",
        i,
        f.claim.split(" ").slice(0, 8).join(" "), // short title from claim
        f.claim,
        f.severity,
        f.evidence_screen_ids,
        f.founder_question
      )
    )
  );

  // Stable sort by severity ladder.
  return out.sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]
  );
}

// ── Hero finding (Phase B2) ────────────────────────────────────────────

/**
 * Pick the single sharpest finding to render above-the-fold as the hero.
 *
 * Selection rules (in order):
 *   1. Highest-severity V2 critical_bug with both explanation_md and an
 *      annotated screenshot — the "wow" moment for first-time viewers.
 *   2. Else highest-severity V2 ux_issue with explanation_md.
 *   3. Else top V1 oracleFinding (legacy reports without V2).
 *   4. Returns null when there's no finding worth featuring (clean run).
 *
 * The hero is *removed* from the CriticalFindings list by id so the same
 * finding doesn't appear twice on the page. The caller does that filter.
 */
export function heroFinding(report: CrawlReport): DisplayFinding | null {
  const all = displayFindings(report);
  if (all.length === 0) return null;

  // Prefer V2 critical_bugs first — they're the highest-impact items by
  // schema. Within them, the displayFindings sort already puts severity
  // 'critical' first; we just take the head.
  const v2CriticalWithExplanation = all.find(
    (f) => f.fromV2 && f.type === "crash" && f.explanationMd
  );
  if (v2CriticalWithExplanation) return v2CriticalWithExplanation;

  // Fall through to highest-severity ux_issue with explanation, then
  // anything with an evidence screen + explanation, then just anything.
  const v2UxWithExplanation = all.find(
    (f) => f.fromV2 && f.type === "ux_issue" && f.explanationMd
  );
  if (v2UxWithExplanation) return v2UxWithExplanation;

  // Legacy V1 path or V2 without explanation_md (older runs) — just the
  // top of the sorted list.
  return all[0] ?? null;
}
