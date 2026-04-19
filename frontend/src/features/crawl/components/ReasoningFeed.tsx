import { AnimatePresence, LayoutGroup, motion, useReducedMotion } from "framer-motion";
import {
  AlertCircle,
  ArrowLeft,
  ChevronUp,
  ChevronDown,
  Clock,
  MousePointerClick,
  Type,
} from "lucide-react";
import { humanizeAction } from "../actionLabels";

export interface ReasoningEntry {
  id: string;
  step: number;
  actionType: string;
  reasoning: string | null;
  expectedOutcome: string | null;
  outcome: "new" | "repeat" | "failed" | "pending";
}

interface ReasoningFeedProps {
  entries: ReasoningEntry[];
  isLive: boolean;
}

function iconFor(actionType: string) {
  const t = actionType.toLowerCase();
  if (t.includes("back")) return <ArrowLeft className="w-3.5 h-3.5" />;
  if (t.includes("swipe_up") || t.includes("swipe-up")) return <ChevronUp className="w-3.5 h-3.5" />;
  if (t.includes("swipe")) return <ChevronDown className="w-3.5 h-3.5" />;
  if (t.includes("type")) return <Type className="w-3.5 h-3.5" />;
  if (t.includes("wait") || t.includes("sleep")) return <Clock className="w-3.5 h-3.5" />;
  return <MousePointerClick className="w-3.5 h-3.5" />;
}

function outcomeMark(outcome: ReasoningEntry["outcome"]) {
  switch (outcome) {
    case "new":
      return { symbol: "✓", color: "#10B981", label: "new screen" };
    case "repeat":
      return { symbol: "○", color: "#F59E0B", label: "same screen" };
    case "failed":
      return { symbol: "✕", color: "#EF4444", label: "action failed" };
    default:
      return { symbol: "·", color: "rgba(148,163,184,0.6)", label: "pending" };
  }
}

export function ReasoningFeed({ entries, isLive }: ReasoningFeedProps) {
  const totalSteps = entries.length;
  const reduceMotion = useReducedMotion();

  return (
    <section
      className="relative rounded-2xl overflow-hidden flex flex-col"
      style={{
        background: "linear-gradient(170deg, rgba(30, 27, 75, 0.50), rgba(18, 18, 43, 0.28))",
        border: "1px solid rgba(108, 71, 255, 0.18)",
        boxShadow:
          "0 20px 44px -12px rgba(0, 0, 0, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.08)",
        backdropFilter: "blur(14px)",
        WebkitBackdropFilter: "blur(14px)",
        minHeight: 240,
        maxHeight: "calc(100vh - 220px)",
      }}
    >
      <header className="flex items-center justify-between px-4 py-3 border-b border-white/5">
        <div>
          <div className="flex items-center gap-2">
            <span
              className="text-[15px] font-semibold text-white"
              style={{ fontFamily: "var(--font-heading)" }}
            >
              Reasoning
            </span>
            {isLive && (
              <motion.span
                className="inline-block w-1.5 h-1.5 rounded-full bg-[#8A6CFF]"
                animate={reduceMotion ? {} : { opacity: [1, 0.3, 1] }}
                transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
              />
            )}
          </div>
          <div className="mt-0.5 text-[11px] text-white/50" style={{ fontFamily: "var(--font-sans)" }}>
            Live reasoning
          </div>
        </div>
        <div
          className="text-[11px] tabular-nums text-white/55"
          style={{ fontFamily: "var(--font-mono)" }}
        >
          {totalSteps} {totalSteps === 1 ? "thought" : "thoughts"}
        </div>
      </header>

      <ul
        className="flex-1 overflow-y-auto px-1 py-1 reasoning-scroll"
        role="log"
        aria-live="polite"
        aria-relevant="additions"
        style={{
          scrollbarWidth: "thin",
          scrollbarColor: "rgba(108,71,255,0.55) transparent",
        }}
      >
        <LayoutGroup>
        <AnimatePresence initial={false}>
          {entries.length === 0 && (
            <motion.li
              key="empty"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="px-4 py-8 text-center text-white/55"
              style={{ fontFamily: "var(--font-sans)" }}
            >
              <div className="text-[13px]">Waiting for first thought…</div>
              <motion.div
                className="mt-2 text-[11px] text-white/35"
                animate={reduceMotion ? {} : { opacity: [0.4, 1, 0.4] }}
                transition={{ duration: 1.6, repeat: Infinity }}
              >
                · · ·
              </motion.div>
            </motion.li>
          )}
          {entries.map((e) => {
            const mark = outcomeMark(e.outcome);
            const isRecovery = e.outcome === "failed";
            return (
              <motion.li
                key={e.id}
                layout={reduceMotion ? false : "position"}
                initial={reduceMotion ? { opacity: 0 } : { opacity: 0, x: 28 }}
                animate={reduceMotion ? { opacity: 1 } : { opacity: 1, x: 0 }}
                exit={{ opacity: 0 }}
                transition={
                  reduceMotion
                    ? { duration: 0.18 }
                    : { type: "spring", stiffness: 120, damping: 22, mass: 0.8 }
                }
                className="px-3 py-2.5 rounded-xl mx-1 my-0.5"
                style={{
                  background: isRecovery ? "rgba(245, 158, 11, 0.06)" : "transparent",
                  borderLeft: isRecovery
                    ? "2px solid rgba(245, 158, 11, 0.55)"
                    : "2px solid transparent",
                }}
              >
                <div className="flex items-center gap-2 mb-1">
                  <span
                    className="text-[10px] font-medium tabular-nums"
                    style={{ fontFamily: "var(--font-mono)", color: "#8A6CFF" }}
                  >
                    #{String(e.step).padStart(2, "0")}
                  </span>
                  <span className="text-white/70 flex items-center gap-1">
                    {isRecovery ? <AlertCircle className="w-3.5 h-3.5" /> : iconFor(e.actionType)}
                    <span
                      className="text-[11px] text-white/70"
                      style={{ fontFamily: "var(--font-sans)", fontWeight: 500 }}
                    >
                      {humanizeAction(e.actionType)}
                    </span>
                  </span>
                  <span
                    className="ml-auto text-[13px] leading-none"
                    style={{ color: mark.color }}
                    aria-label={mark.label}
                    title={mark.label}
                  >
                    {mark.symbol}
                  </span>
                </div>
                <div
                  className="text-[13px] text-white/90 leading-snug"
                  style={{ fontFamily: "var(--font-sans)" }}
                >
                  {e.reasoning || "(no reasoning available)"}
                </div>
                {e.expectedOutcome && (
                  <div
                    className="mt-1 text-[11px] text-white/55 truncate"
                    style={{ fontFamily: "var(--font-mono)" }}
                    title={e.expectedOutcome}
                  >
                    → {e.expectedOutcome}
                  </div>
                )}
              </motion.li>
            );
          })}
        </AnimatePresence>
        </LayoutGroup>
      </ul>
    </section>
  );
}
