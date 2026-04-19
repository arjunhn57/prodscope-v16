import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion, useReducedMotion } from "framer-motion";
import { ArrowLeft, ChevronRight } from "lucide-react";

type TerminalStatus = "complete" | "degraded" | "failed";

interface CinematicTopBarProps {
  jobId: string | undefined;
  packageName: string | null | undefined;
  startedAt: number | null;
  isLive: boolean;
  terminalStatus?: TerminalStatus | null;
}

function formatElapsed(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const mm = Math.floor(totalSec / 60).toString().padStart(2, "0");
  const ss = (totalSec % 60).toString().padStart(2, "0");
  return `${mm}:${ss}`;
}

const TERMINAL_META: Record<TerminalStatus, { label: string; color: string }> = {
  complete: { label: "complete", color: "#10B981" },
  degraded: { label: "degraded", color: "#F59E0B" },
  failed: { label: "failed", color: "#EF4444" },
};

export function CinematicTopBar({ jobId, packageName, startedAt, isLive, terminalStatus }: CinematicTopBarProps) {
  const navigate = useNavigate();
  const reduceMotion = useReducedMotion();
  const [now, setNow] = useState(() => Date.now());
  const [colonOn, setColonOn] = useState(true);
  const [frozenElapsed, setFrozenElapsed] = useState<number | null>(null);

  const isTerminal = !!terminalStatus;

  useEffect(() => {
    if (isTerminal) {
      if (startedAt && frozenElapsed === null) setFrozenElapsed(Date.now() - startedAt);
      return;
    }
    if (!startedAt) return;
    const id = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(id);
  }, [startedAt, isTerminal, frozenElapsed]);

  useEffect(() => {
    if (!startedAt || !isLive || isTerminal || reduceMotion) {
      setColonOn(true);
      return;
    }
    const id = window.setInterval(() => setColonOn((v) => !v), 500);
    return () => window.clearInterval(id);
  }, [startedAt, isLive, isTerminal, reduceMotion]);

  const elapsedMs = frozenElapsed ?? (startedAt ? now - startedAt : 0);
  const elapsed = formatElapsed(elapsedMs);
  const [mm, ss] = elapsed.split(":");
  const jobShort = jobId ? jobId.slice(0, 8) : "—";

  const chipColor = isTerminal
    ? TERMINAL_META[terminalStatus as TerminalStatus].color
    : isLive
      ? "#10B981"
      : "#64748B";
  const chipLabel = isTerminal
    ? TERMINAL_META[terminalStatus as TerminalStatus].label
    : isLive
      ? "live"
      : "idle";
  const chipPulse = isLive && !isTerminal && !reduceMotion;

  return (
    <header
      className="sticky top-0 z-40 flex items-center justify-between h-16 px-6 md:px-8 border-b"
      style={{
        background: "rgba(10, 10, 20, 0.6)",
        backdropFilter: "blur(20px)",
        WebkitBackdropFilter: "blur(20px)",
        borderColor: "rgba(108, 71, 255, 0.12)",
      }}
    >
      <div className="flex items-center gap-3 min-w-0">
        <button
          type="button"
          onClick={() => navigate("/uploads")}
          className="flex-shrink-0 flex items-center justify-center w-8 h-8 rounded-lg text-white/60 hover:text-white hover:bg-white/5 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-[#C9BBFF] focus-visible:ring-offset-2 focus-visible:ring-offset-[#0A0A14]"
          aria-label="Close live view"
          title="Close"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <span
          className="flex-shrink-0 text-[15px] font-semibold tracking-tight text-white select-none"
          style={{ fontFamily: "var(--font-heading)" }}
        >
          prodscope.
        </span>
        <span
          className="md:hidden text-white/50 text-[11px] truncate min-w-0"
          style={{ fontFamily: "var(--font-mono)" }}
          title={`${packageName || "—"} · #${jobShort}`}
        >
          {packageName ? packageName.length > 20 ? packageName.slice(0, 20) + "…" : packageName : "—"}
          <span className="text-white/25"> · </span>
          #{jobShort}
        </span>
      </div>

      <div className="hidden md:flex items-center gap-2 text-[12px]" style={{ fontFamily: "var(--font-mono)" }}>
        <span className="text-white/70 max-w-[240px] truncate">{packageName || "—"}</span>
        <ChevronRight className="w-3.5 h-3.5 text-white/25" />
        <span className="text-white/70">Run #{jobShort}</span>
      </div>

      <div className="flex-shrink-0 flex items-center gap-3 md:gap-4">
        <span
          className="text-[13px] tabular-nums text-white/90"
          style={{ fontFamily: "var(--font-mono)" }}
          aria-label={`Elapsed ${elapsed}`}
        >
          {mm}
          <span style={{ opacity: colonOn ? 1 : 0.25, transition: "opacity 220ms ease-out" }}>:</span>
          {ss}
        </span>
        <div className="flex items-center gap-1.5">
          <motion.span
            className="inline-block w-2 h-2 rounded-full"
            style={{ background: chipColor }}
            animate={chipPulse ? { opacity: [1, 0.4, 1], scale: [1, 1.18, 1] } : {}}
            transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
          />
          <span
            className="text-[10px] uppercase tracking-[0.14em] font-medium"
            style={{ color: `${chipColor}f0` }}
          >
            {chipLabel}
          </span>
        </div>
      </div>
    </header>
  );
}
