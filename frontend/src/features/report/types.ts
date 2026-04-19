/**
 * Typed shape of the ProdScope crawl artifact.
 *
 * Mirrors `crawler/report-assembler.js` output (`crawl_artifacts.json`).
 * The frontend hook `useReportData` normalizes the raw `job.report` payload
 * into this shape defensively — missing fields are tolerated.
 */

export type Severity = "critical" | "high" | "medium" | "low";

export type CrawlQuality = "full" | "degraded" | "minimal";

export type ReportStatus = "complete" | "degraded" | "failed";

export type FindingType =
  | "crash"
  | "anr"
  | "missing_content_description"
  | "small_tap_target"
  | "slow_transition"
  | string;

export interface ScreenRecord {
  index: number;
  step: number;
  path: string | null;
  activity: string;
  timestamp: number | null;
  xml?: string;
  screenType: string;
  feature: string;
  fuzzyFp: string;
}

export interface ActionRecord {
  step: number;
  type: string;
  description?: string;
  reason?: string;
  outcome?: string;
}

export interface GraphNode {
  fingerprint: string;
  activity: string;
  screenshotPath: string | null;
  visitCount: number;
  triedActions: string[];
  actionOutcomes: Record<string, string>;
}

export interface GraphTransition {
  from: string;
  action: string;
  to: string;
  ts?: number;
}

export interface CrawlGraph {
  nodes: GraphNode[];
  transitions: GraphTransition[];
  totalSteps: number;
  uniqueStates: number;
  parentMap: Record<string, unknown>;
}

export interface Finding {
  id: string;
  type: FindingType;
  severity: Severity;
  detail: string;
  step: number;
  element?: string;
  screenshotPath?: string | null;
}

export interface CrawlStats {
  totalSteps: number;
  uniqueStates: number;
  totalTransitions: number;
  recoveryStats: Record<string, { attempts?: number; successes?: number }>;
  tokenUsage: { input_tokens?: number; output_tokens?: number };
}

export interface V2Coverage {
  stepsUsed: number;
  uniqueScreens: number;
  uniquePerStep: number;
  uniquePerMinute: number;
  stepsWastedOnRecovery: number;
  visionFirstMode?: boolean;
  tokenUsage?: {
    inputTokens?: number;
    outputTokens?: number;
    cacheCreationInputTokens?: number;
    cacheReadInputTokens?: number;
  };
  costUSD: number;
  cacheHitRate: number;
}

export interface FlowRecord {
  name: string;
  status: "completed" | "partial" | "failed" | string;
  steps?: number;
}

export interface CrawlMetrics {
  stepTimings?: { avgMs?: number; medianMs?: number; p95Ms?: number };
  readinessWaits?: { total?: number; avgMs?: number };
  actionOutcomes?: Record<string, number>;
  recoveryEvents?: number;
  ineffectiveActionRate?: number;
}

export interface Recommendation {
  id: string;
  title: string;
  area: "ux" | "accessibility" | "stability" | "navigation" | "performance";
  severity: Severity;
  effort: "XS" | "S" | "M" | "L";
  description: string;
  linkedFindingIds?: string[];
}

export interface ScoreBreakdown {
  overall: number;
  stability: number;
  ux: number;
  coverage: number;
  performance: number;
}

export interface CrawlReport {
  jobId: string;
  packageName: string;
  appName?: string;
  completedAt: string;
  status: ReportStatus;
  stopReason: string;
  crawlQuality: CrawlQuality;
  engineVersion?: string;
  model?: string;

  screens: ScreenRecord[];
  actionsTaken: ActionRecord[];
  graph: CrawlGraph;
  stats: CrawlStats;
  oracleFindings: Finding[];
  oracleFindingsByStep: Record<number, Finding[]>;
  coverage: Record<string, number>;
  v2Coverage: V2Coverage;
  flows: FlowRecord[];
  metrics: CrawlMetrics;
}

/**
 * Cluster of screens grouped by classifier (screenType or feature).
 */
export interface ScreenCluster {
  classifier: string;
  coverPath: string | null;
  screens: ScreenRecord[];
}

/**
 * Reproduction breadcrumb — ordered list of screens that led to a finding.
 */
export interface ReproTrail {
  finding: Finding;
  breadcrumbs: Array<{ label: string; activity: string; step: number }>;
  screenshotPath: string | null;
}

/**
 * Coverage row for the bar chart.
 */
export interface CoverageRow {
  area: string;
  covered: number;
  total: number;
  percentage: number;
  blockedReason?: string;
}
