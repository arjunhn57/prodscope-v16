import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { MessageSquareText, X } from "lucide-react";
import { useJobStatus, type SSEPayload } from "../../api/hooks";
import { useJobSSE } from "../../api/sse";
import { useAuthStore } from "../../stores/auth";
import { API_BASE } from "../../lib/constants";
import { CinematicTopBar } from "./components/CinematicTopBar";
import { PhaseTile } from "./components/PhaseTile";
import { ProgressTile } from "./components/ProgressTile";
import { UniqueScreensTile } from "./components/UniqueScreensTile";
import { ActivityTile } from "./components/ActivityTile";
import { SessionTile } from "./components/SessionTile";
import { PhoneStream } from "./components/PhoneStream";
import { ReasoningFeed, type ReasoningEntry } from "./components/ReasoningFeed";
import { StepTimeline, type StepOutcome } from "./components/StepTimeline";
import { TerminalOverlay } from "./components/TerminalOverlay";
import { ConnectionBanner } from "./components/ConnectionBanner";
import { TelemetryTilesSkeleton } from "./components/TileSkeleton";
import type { PerceptionBox, TapTarget } from "./components/OverlayCanvas";

type TerminalStatus = "complete" | "degraded" | "failed";

function useSSEData(jobId: string | undefined): SSEPayload | undefined {
  const queryClient = useQueryClient();
  const [data, setData] = useState<SSEPayload | undefined>(() =>
    jobId ? queryClient.getQueryData<SSEPayload>(["job-sse", jobId]) : undefined
  );
  useEffect(() => {
    if (!jobId) return;
    setData(queryClient.getQueryData<SSEPayload>(["job-sse", jobId]));
    const unsub = queryClient.getQueryCache().subscribe((event) => {
      const q = event.query;
      if (!Array.isArray(q.queryKey)) return;
      if (q.queryKey[0] === "job-sse" && q.queryKey[1] === jobId) {
        setData(queryClient.getQueryData<SSEPayload>(["job-sse", jobId]));
      }
    });
    return () => {
      unsub();
    };
  }, [jobId, queryClient]);
  return data;
}

function mmss(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const mm = Math.floor(totalSec / 60).toString().padStart(2, "0");
  const ss = (totalSec % 60).toString().padStart(2, "0");
  return `${mm}:${ss}`;
}

function coerceTerminal(status: string | undefined): TerminalStatus | null {
  if (status === "complete" || status === "degraded" || status === "failed") return status;
  return null;
}

export function LiveCrawlPage() {
  const { jobId } = useParams<{ jobId: string }>();
  const reduceMotion = useReducedMotion();
  const token = useAuthStore((s) => s.token);
  const { data: job } = useJobStatus(jobId);
  const connection = useJobSSE(jobId);
  const sseData = useSSEData(jobId);
  const live = sseData?.live;

  const step = live?.rawStep ?? 0;
  const maxSteps = live?.maxRawSteps ?? 80;
  const uniqueScreens = live?.countedUniqueScreens ?? 0;
  const phase = live?.phase ?? (job?.status === "queued" ? "queued" : undefined);
  const terminalStatus = coerceTerminal(job?.status);
  const isTerminal = !!terminalStatus;
  const isLive = !!live && !isTerminal;
  const isBooting = !live && !isTerminal;

  const streamUrl =
    jobId && token
      ? `${API_BASE}/job-live-stream/${jobId}?api_key=${encodeURIComponent(token)}`
      : "";

  // ── Session start clock: first SSE tick ────────────────────────────────────
  const startedAtRef = useRef<number | null>(null);
  if (startedAtRef.current === null && live && live.rawStep !== null) {
    startedAtRef.current = Date.now();
  }
  const startedAt = startedAtRef.current;

  // ── Pace baseline: first non-zero step (excludes boot cost) ────────────────
  const firstTickAtRef = useRef<number | null>(null);
  const firstTickStepRef = useRef<number>(0);
  if (firstTickAtRef.current === null && live && (live.rawStep ?? 0) > 0) {
    firstTickAtRef.current = Date.now();
    firstTickStepRef.current = live.rawStep ?? 0;
  }

  // ── Mobile reasoning drawer state ──────────────────────────────────────────
  const [mobileFeedOpen, setMobileFeedOpen] = useState(false);

  useEffect(() => {
    if (!mobileFeedOpen) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMobileFeedOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [mobileFeedOpen]);

  // ── Reasoning accumulator: dedupe by step ──────────────────────────────────
  const [entries, setEntries] = useState<ReasoningEntry[]>([]);
  const lastStepRef = useRef<number>(-1);
  const prevUniqueRef = useRef<number>(0);

  useEffect(() => {
    if (!live) return;
    const s = live.rawStep ?? -1;
    if (s < 0) return;

    const reasoning = live.reasoning || null;
    const expected = live.expectedOutcome || null;
    const latestAction = live.latestAction;
    const actionType =
      typeof latestAction === "object" && latestAction
        ? latestAction.type
        : typeof latestAction === "string"
          ? latestAction
          : "step";

    // Skip ticks with no usable payload.
    if (!reasoning && actionType === "step") return;

    const isNewScreen = uniqueScreens > prevUniqueRef.current;
    const recovering = (phase || "").toLowerCase().includes("recover");
    const outcome: ReasoningEntry["outcome"] = recovering
      ? "failed"
      : isNewScreen
        ? "new"
        : "repeat";

    const id = `step-${s}`;
    setEntries((prev) => {
      const idx = prev.findIndex((e) => e.id === id);
      const merged: ReasoningEntry = {
        id,
        step: s + 1,
        actionType,
        reasoning: reasoning ?? (idx >= 0 ? prev[idx].reasoning : null),
        expectedOutcome: expected ?? (idx >= 0 ? prev[idx].expectedOutcome : null),
        outcome,
      };
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = merged;
        return next;
      }
      return [merged, ...prev].slice(0, 200);
    });

    lastStepRef.current = s;
    prevUniqueRef.current = uniqueScreens;
  }, [live, uniqueScreens, phase]);

  // ── Step outcomes for timeline ─────────────────────────────────────────────
  const outcomes: StepOutcome[] = useMemo(() => {
    const map: StepOutcome[] = new Array(Math.max(1, maxSteps)).fill("pending");
    // entries are newest-first; iterate reverse to fill oldest-first
    [...entries].reverse().forEach((e) => {
      const idx = Math.max(0, (e.step || 1) - 1);
      if (idx >= map.length) return;
      if (e.outcome === "new") map[idx] = "new";
      else if (e.outcome === "failed") map[idx] = "failed";
      else if (e.outcome === "repeat") map[idx] = "repeat";
    });
    return map;
  }, [entries, maxSteps]);

  // ── Overlay stage FSM: awareness → decision → action ───────────────────────
  const [stage, setStage] = useState<"idle" | "awareness" | "decision" | "action">("idle");
  const [actionKey, setActionKey] = useState<string | number | null>(null);
  const prevStepRef = useRef<number>(-1);

  useEffect(() => {
    if (!live || reduceMotion) return;
    const s = live.rawStep ?? -1;
    if (s < 0) return;
    const hasTap = !!live.tapTarget;
    const hasBoxes = (live.perceptionBoxes || []).length > 0;
    if (hasTap && s !== prevStepRef.current) {
      // Post-action tick: play decision → action
      setStage("decision");
      setActionKey(`${s}-${live.tapTarget?.x ?? 0}-${live.tapTarget?.y ?? 0}`);
      const t1 = window.setTimeout(() => setStage("action"), 600);
      const t2 = window.setTimeout(() => setStage("awareness"), 1100);
      prevStepRef.current = s;
      return () => {
        window.clearTimeout(t1);
        window.clearTimeout(t2);
      };
    }
    if (hasBoxes && stage === "idle") {
      setStage("awareness");
    }
  }, [live, reduceMotion, stage]);

  const boxes: PerceptionBox[] = live?.perceptionBoxes || [];
  const tapTarget: TapTarget | null = live?.tapTarget || null;

  // Elapsed string for TerminalOverlay
  const elapsed = startedAt ? mmss(Date.now() - startedAt) : "00:00";

  const RAW_MESSAGE_BLOCKLIST = new Set([
    "initializing",
    "queued",
    "starting",
    "complete",
    "done",
    "running",
  ]);
  const rawMessage = live?.message;
  const safeMessage =
    rawMessage && !RAW_MESSAGE_BLOCKLIST.has(rawMessage.toLowerCase().trim())
      ? rawMessage
      : null;
  const fallbackCaption =
    typeof live?.latestAction === "object" && live?.latestAction
      ? `${live.latestAction.type}: ${live.latestAction.description}`
      : typeof live?.latestAction === "string"
        ? live.latestAction
        : safeMessage;

  const baseAt = firstTickAtRef.current;
  const baseStep = firstTickStepRef.current;
  const deltaSteps = Math.max(0, step - baseStep);
  const avgSecPerStep =
    baseAt && deltaSteps > 0 ? (Date.now() - baseAt) / 1000 / deltaSteps : null;

  return (
    <div className="relative min-h-dvh w-full overflow-x-hidden" style={{ background: "#0A0A14" }}>
      {/* Atmospherics */}
      <Atmospherics reduceMotion={!!reduceMotion} />

      <CinematicTopBar
        jobId={jobId}
        packageName={live?.packageName || null}
        startedAt={startedAt}
        isLive={isLive}
        terminalStatus={terminalStatus}
      />

      <ConnectionBanner
        visible={connection.status === "error" && !isTerminal}
        retryAt={connection.retryAt}
        attempt={connection.attempt}
      />

      <main className="relative z-10 px-4 md:px-6 lg:px-8 pb-10 pt-6 mx-auto" style={{ maxWidth: 1440 }}>
        <div className="grid gap-6 md:grid-cols-12 items-start">
          {/* Left Rail — Telemetry (lg only as 3-col; md splits below) */}
          <aside className="hidden lg:block lg:col-span-3 space-y-4 order-2 lg:order-1">
            {isBooting ? (
              <TelemetryTilesSkeleton />
            ) : (
              <>
                <PhaseTile phase={phase} activity={live?.activity || null} isTerminal={isTerminal} />
                <ProgressTile step={step} maxSteps={maxSteps} avgSecPerStep={avgSecPerStep} />
                <UniqueScreensTile count={uniqueScreens} />
                <ActivityTile activity={live?.activity || null} intentType={live?.intentType || null} isTerminal={isTerminal} />
                <SessionTile startedAt={startedAt} step={step} maxSteps={maxSteps} isTerminal={isTerminal} />
              </>
            )}
          </aside>

          {/* Center — Phone */}
          <section className="md:col-span-7 lg:col-span-6 order-1 lg:order-2 flex items-start justify-center pt-2">
            <div className="relative w-full max-w-[420px] mx-auto">
              <PhoneStream
                streamUrl={streamUrl}
                boxes={boxes}
                tapTarget={tapTarget}
                stage={stage === "idle" ? "idle" : stage}
                actionKey={actionKey}
                reasoning={live?.reasoning || null}
                expectedOutcome={live?.expectedOutcome || null}
                fallbackCaption={fallbackCaption}
                isTerminal={isTerminal}
                placeholderLabel={
                  job?.status === "queued" ? "Queued…" : "Booting emulator…"
                }
              />
              {isTerminal && terminalStatus && (
                <TerminalOverlay
                  status={terminalStatus}
                  jobId={jobId}
                  stats={{
                    uniqueScreens,
                    elapsed,
                    steps: step,
                    maxSteps,
                  }}
                />
              )}
            </div>
          </section>

          {/* Right Rail — Reasoning Feed (md shows at col-span-5, lg at 3; mobile uses drawer) */}
          <aside className="hidden md:block md:col-span-5 lg:col-span-3 order-3 lg:order-3">
            <ReasoningFeed entries={entries} isLive={isLive} />
          </aside>

          {/* Telemetry for md only — 2-col grid below phone/reasoning */}
          <div className="md:col-span-12 lg:hidden order-4 grid gap-4 grid-cols-1 md:grid-cols-2">
            {isBooting ? (
              <TelemetryTilesSkeleton />
            ) : (
              <>
                <PhaseTile phase={phase} activity={live?.activity || null} isTerminal={isTerminal} />
                <ProgressTile step={step} maxSteps={maxSteps} avgSecPerStep={avgSecPerStep} />
                <UniqueScreensTile count={uniqueScreens} />
                <ActivityTile activity={live?.activity || null} intentType={live?.intentType || null} isTerminal={isTerminal} />
                <SessionTile startedAt={startedAt} step={step} maxSteps={maxSteps} isTerminal={isTerminal} />
              </>
            )}
          </div>
        </div>

        {/* Timeline */}
        <div className="mt-6">
          <StepTimeline currentStep={step} maxSteps={maxSteps} outcomes={outcomes} />
        </div>
      </main>

      {/* Mobile Reasoning — floating pill + bottom sheet (md:hidden) */}
      <button
        type="button"
        onClick={() => setMobileFeedOpen(true)}
        aria-label={`Open reasoning feed, ${entries.length} ${entries.length === 1 ? "thought" : "thoughts"}`}
        className="md:hidden fixed bottom-5 right-4 z-30 inline-flex items-center gap-2 px-4 py-2.5 rounded-full text-[13px] font-semibold text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(138,108,255,0.6)] transition-transform active:scale-[0.97]"
        style={{
          background: "linear-gradient(135deg, #6C47FF 0%, #8A6CFF 50%, #DB2777 100%)",
          boxShadow: "0 12px 28px -12px rgba(108,71,255,0.6), 0 4px 12px -4px rgba(0,0,0,0.3)",
          fontFamily: "var(--font-sans)",
        }}
      >
        <MessageSquareText className="w-4 h-4" aria-hidden="true" />
        Thoughts
        <span
          className="tabular-nums rounded-full bg-white/20 px-1.5 py-0.5 text-[11px]"
          style={{ fontFamily: "var(--font-mono)" }}
        >
          {entries.length}
        </span>
      </button>

      <AnimatePresence>
        {mobileFeedOpen && (
          <motion.div
            key="mobile-feed-backdrop"
            className="md:hidden fixed inset-0 z-40 bg-black/60"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={() => setMobileFeedOpen(false)}
          >
            <motion.div
              key="mobile-feed-sheet"
              role="dialog"
              aria-modal="true"
              aria-label="Reasoning feed"
              className="absolute inset-x-0 bottom-0 flex flex-col"
              style={{ maxHeight: "80vh" }}
              initial={reduceMotion ? { opacity: 0 } : { y: "100%" }}
              animate={reduceMotion ? { opacity: 1 } : { y: 0 }}
              exit={reduceMotion ? { opacity: 0 } : { y: "100%" }}
              transition={{ type: "spring", damping: 32, stiffness: 320 }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between px-4 pt-3 pb-2">
                <div
                  className="mx-auto w-10 h-1 rounded-full bg-white/25 absolute left-1/2 -translate-x-1/2 top-2"
                  aria-hidden="true"
                />
                <span
                  className="text-[13px] font-semibold text-white/80 pt-1.5"
                  style={{ fontFamily: "var(--font-heading)" }}
                >
                  Reasoning
                </span>
                <button
                  type="button"
                  onClick={() => setMobileFeedOpen(false)}
                  aria-label="Close reasoning feed"
                  className="w-8 h-8 rounded-full flex items-center justify-center bg-white/8 hover:bg-white/15 text-white/70 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(138,108,255,0.6)]"
                >
                  <X className="w-4 h-4" aria-hidden="true" />
                </button>
              </div>
              <div className="px-3 pb-[max(12px,env(safe-area-inset-bottom))] flex-1 min-h-0">
                <ReasoningFeed entries={entries} isLive={isLive} />
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Atmospherics({ reduceMotion }: { reduceMotion: boolean }) {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 z-0 overflow-hidden"
      style={{
        background:
          "linear-gradient(180deg, #0A0A14 0%, #12122B 45%, #1E1B4B 100%)",
      }}
    >
      {/* Top edge fade preserves continuity */}
      <div
        className="absolute inset-x-0 top-0 h-24"
        style={{
          background: "linear-gradient(180deg, rgba(10,10,20,0.95) 0%, rgba(10,10,20,0) 100%)",
        }}
      />
      {/* Indigo orb — top right */}
      <div
        className="absolute"
        style={{
          top: "-10%",
          right: "-12%",
          width: "48%",
          height: "48%",
          borderRadius: "9999px",
          background: "radial-gradient(circle, #4C1D95 0%, transparent 65%)",
          filter: "blur(120px)",
          opacity: 0.3,
        }}
      />
      {/* Magenta orb — bottom left */}
      <div
        className="absolute"
        style={{
          bottom: "-14%",
          left: "-14%",
          width: "50%",
          height: "50%",
          borderRadius: "9999px",
          background: "radial-gradient(circle, #DB2777 0%, transparent 65%)",
          filter: "blur(140px)",
          opacity: 0.2,
        }}
      />
      {/* Subtle grid pattern */}
      {!reduceMotion && (
        <svg
          className="absolute inset-0 w-full h-full"
          style={{ opacity: 0.035, mixBlendMode: "screen" }}
          xmlns="http://www.w3.org/2000/svg"
        >
          <defs>
            <pattern id="cinematic-grid" width="48" height="48" patternUnits="userSpaceOnUse">
              <path d="M 48 0 L 0 0 0 48" fill="none" stroke="#8A6CFF" strokeWidth="0.6" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#cinematic-grid)" />
        </svg>
      )}
    </div>
  );
}
