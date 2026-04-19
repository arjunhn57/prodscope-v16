/**
 * crawl-context.d.ts — Ambient types for the CrawlContext container.
 *
 * Consumed by // @ts-check directives in .js files. Zero runtime impact,
 * zero runtime dependencies. Lives in a sidecar so crawl-context.js
 * stays readable.
 *
 * Opaque external types (AuthStateMachine, StateGraph, PerceptionCache,
 * etc.) are kept as minimal structural types to avoid chasing cross-file
 * type imports that would require checkJs: true in every owning module.
 * We prefer a small amount of duplication over a large amount of
 * type-system plumbing.
 */

// ── Secondary / shared shapes ────────────────────────────────────────────

export interface ActionOutcomeEntry {
  ok: number;
  bad: number;
  newScreen: number;
  lastOutcome: string | null;
}

export interface ScreenMemoryEntry {
  screenType: string | null;
  feature: string | null;
  actionOutcomes: Record<string, ActionOutcomeEntry>;
  totalVisits: number;
}

export interface Classification {
  type: string;
  feature: string;
}

export interface AppKnowledge {
  authMethod: string | null;
  hasGuestMode: boolean | null;
  escapeLabels: string[];
  frameworkType: string | null;
  avgScreenCount: number | null;
  knownDialogs: string[];
  flagSecure: boolean;
  crawlCount: number;
  appVersion: string | null;
}

export interface Credentials {
  email?: string;
  username?: string;
  password?: string;
  phone?: string;
}

export interface CredentialState {
  emailEntered: boolean;
  passwordEntered: boolean;
  phoneEntered: boolean;
  usernameEntered: boolean;
  otpEntered: boolean;
  submittedCount: number;
  lastSubmittedHash: string | null;
  pagesTraversed: number;
  errors: string[];
}

export interface JournalEntry {
  step?: number;
  action?: string;
  outcome?: string;
  fp?: string;
  [key: string]: unknown;
}

export interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
}

/**
 * V2 token usage with Anthropic prompt-caching fields. Used by the
 * AGENT_VISION_FIRST=true code path and the V2 coverage report.
 * Kept distinct from TokenUsage so V1 snake_case accumulators continue
 * to work unchanged.
 */
export interface V2TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
}

/**
 * V2 coverage report section. Populated on every crawl regardless of
 * mode — `visionFirstMode` indicates whether the V2 code path was active.
 */
export interface V2CoverageReport {
  stepsUsed: number;
  uniqueScreens: number;
  uniquePerStep: number;
  uniquePerMinute: number;
  stepsWastedOnRecovery: number;
  visionFirstMode: boolean;
  tokenUsage: V2TokenUsage;
  costUSD: number;
  cacheHitRate: number;
}

export interface NavTab {
  label: string;
  x: number;
  y: number;
}

export interface MainAction {
  description: string;
  x: number;
  y: number;
  priority: 'high' | 'medium' | 'low';
}

export interface VisionResult {
  screenType: string;
  screenDescription?: string;
  mainActions: MainAction[];
  navBar: { hasNav: boolean; tabs: NavTab[] };
  isAuthScreen: boolean;
  isLoading: boolean;
  contentDensity: 'high' | 'medium' | 'low' | 'empty';
  _tokenUsage?: TokenUsage;
}

// Opaque structural shapes for external module types.
// These are intentionally loose — the goal is property-access typo
// detection on ctx, not deep validation of every collaborator.

export type AuthStateMachineLike = any;

export type StateGraphLike = any;

export interface PerceptionCacheLike {
  get(ssHash: string): { perception: any; fuzzy: boolean } | null;
  set(ssHash: string, perception: any): void;
  setFuzzyThreshold?(threshold: number): void;
  readonly size: number;
}

// AppMap is an opaque external class. Typed as `any` so consumers can call
// its methods without the typo guard complaining; the guard still fires on
// the field name itself (`ctx.appMap` vs `ctx.appMpa`).
export type AppMapLike = any;

export interface CrawlLoggerLike {
  info(obj: unknown, msg?: string): void;
  warn(obj: unknown, msg?: string): void;
  error(obj: unknown, msg?: string): void;
  debug(obj: unknown, msg?: string): void;
  trace(obj: unknown, msg?: string): void;
  child(bindings: Record<string, unknown>): CrawlLoggerLike;
}

// ── Field groups ─────────────────────────────────────────────────────────

export interface ImmutableConfig {
  readonly screenshotDir: string;
  readonly packageName: string;
  readonly credentials: Credentials | null | undefined;
  readonly goldenPath: string | null;
  readonly goals: string;
  readonly painPoints: string;
  readonly maxSteps: number;
  readonly onProgress: ((update: unknown) => void) | null;
  readonly launcherActivity: string | null;
  readonly hasValidCredentials: boolean;
}

export interface Logging {
  traceId: string | null;
  log: CrawlLoggerLike;
}

export interface CoreCrawlState {
  stateGraph: any;
  screens: any[];
  actionsTaken: any[];
  stopReason: string;
  metrics: any;
  appMap: AppMapLike;
}

export interface DiscoveryState {
  consecutiveNoNewState: number;
  discoveryWindow: unknown[];
  discoveryStopEligibleStep: number;
  recentFpWindow: string[];
  recentScreenshotHashes: string[];
  visitedCounts: Map<string, number>;
}

export interface DeviceHealth {
  consecutiveDeviceFails: number;
  consecutiveCaptureFails: number;
  totalCaptureRecoveries: number;
}

export interface AuthState {
  authMachine: AuthStateMachineLike;
  credentialState: CredentialState;
  handledFormScreens: Set<string>;
  filledFingerprints: Set<string>;
  authFillCount: number;
  authFlowActive: boolean;
  authFlowStepsRemaining: number;
  lastAuthSubmitKey: string | null;
  consecutiveSameAuthSubmit: number;
}

export interface NavRecovery {
  outOfAppRecoveries: number;
  navStructure: unknown | null;
  saturationCooldown: number;
  appCrashTimestamps: number[];
  consecutiveActionFails: number;
  globalRecoveryAttempts: number;
  // Modules are loosely typed with `any` so consumers can call methods
  // without losing the CrawlContext-level typo guard on the field name.
  // Ideal future work: replace with RecoveryManagerLike once recovery.js is typed.
  recoveryManager: any;
  _replanAt40Done: boolean;
  _replanAt70Done: boolean;
}

export interface Modules {
  modeManager: any;
  appState: any;
  flowTracker: any;
  dedup: any;
  watchdog: any;
  coverageTracker: any;
  plan: any;
}

export interface UiResilience {
  screenshotOnlyMode: boolean;
  uiAutomatorRestartAttempts: number;
  consecutiveXmlFailedSteps: number;
  MAX_UIAUTOMATOR_RESTARTS: number;
}

export interface VisionState {
  visionResult: any;
  visionActionCache: Map<string, any>;
  perceptionCache: PerceptionCacheLike;
}

export interface ExplorationHeuristics {
  homeFingerprint: string | null;
  lastNewScreenFp: string | null;
  actionsOnNewScreen: number;
  consecutiveSysHandlerSteps: number;
  consecutiveFormVisits: number;
  consecutiveIneffectiveTaps: number;
  lastActionKey: string | null;
  lastActionFromFp: string | null;
  explorationJournal: JournalEntry[];
  lastActionOutcome: unknown | null;
  oracleFindingsByStep: Record<number, unknown>;
  scrollDepthByFp: Map<string, number>;
  _frameworkAdaptive: boolean;
}

export interface CrossCrawlMemory {
  screenMemory: Map<string, ScreenMemoryEntry>;
  classificationsByFp: Map<string, Classification>;
  appKnowledge: AppKnowledge | null;
}

export interface MetaFlags {
  tokenUsage: TokenUsage;
  lastLiveAction: unknown | null;
  authResolved: boolean;
  surveyComplete: boolean;
  permissionBurstDone: boolean;
  // V2 vision-first mode (additive — V1 code path unaffected)
  visionFirstMode: boolean;
  v2TokenUsage: V2TokenUsage;
  // Track G: timing instrumentation for coverage metrics. Stamped by
  // runCrawl() so buildV2Coverage() can compute uniquePerMinute.
  // Initialized to 0 in CrawlContext; set to Date.now() by runCrawl().
  startTime: number;
  endTime: number;
  // Track G: ephemeral in-loop counter — previous unique screen count,
  // used to compute per-step isNewScreen in the coverage log.
  _prevUniqueCount: number;
}

// ── Composite type ───────────────────────────────────────────────────────

export interface CrawlContext extends
  ImmutableConfig,
  Logging,
  CoreCrawlState,
  DiscoveryState,
  DeviceHealth,
  AuthState,
  NavRecovery,
  Modules,
  UiResilience,
  VisionState,
  ExplorationHeuristics,
  CrossCrawlMemory,
  MetaFlags {}

// ── Constructor config ───────────────────────────────────────────────────

export interface CrawlContextConfig {
  screenshotDir: string;
  packageName: string;
  credentials?: Credentials | null;
  goldenPath?: string | null;
  goals?: string;
  painPoints?: string;
  maxSteps?: number;
  onProgress?: ((update: unknown) => void) | null;
  appProfile?: { launcherActivity?: string | null } | null;
  traceId?: string | null;
  log?: CrawlLoggerLike;
  jobId?: string;
}
