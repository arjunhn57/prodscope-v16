import { motion } from "framer-motion";
import { ArrowRight } from "lucide-react";
import { useNavigate } from "react-router-dom";

type TerminalStatus = "complete" | "degraded" | "failed";

interface TerminalOverlayProps {
  status: TerminalStatus;
  jobId: string | undefined;
  stats: { uniqueScreens: number; elapsed: string; steps: number; maxSteps: number };
}

const HEADLINE: Record<TerminalStatus, string> = {
  complete: "Analysis complete.",
  degraded: "Analysis degraded.",
  failed: "Analysis failed.",
};

const GRADIENT = "linear-gradient(120deg, #C9BBFF 0%, #8A6CFF 35%, #6C47FF 65%, #F472B6 100%)";

export function TerminalOverlay({ status, jobId, stats }: TerminalOverlayProps) {
  const navigate = useNavigate();
  const coverage = stats.maxSteps > 0 ? Math.round((stats.steps / stats.maxSteps) * 100) : 0;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.4 }}
      className="absolute inset-0 z-30 flex flex-col items-center justify-center pointer-events-none"
      style={{ background: "linear-gradient(180deg, rgba(10,10,20,0.05) 0%, rgba(10,10,20,0.55) 100%)" }}
    >
      <div className="pointer-events-auto text-center max-w-md px-6">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15, duration: 0.45, ease: [0.22, 0.61, 0.36, 1] }}
          className="text-[34px] leading-tight font-semibold"
          style={{
            fontFamily: "var(--font-heading)",
            background: GRADIENT,
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
            backgroundClip: "text",
            letterSpacing: "-0.02em",
          }}
        >
          {HEADLINE[status]}
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3, duration: 0.4 }}
          className="mt-5 inline-flex items-center gap-4 px-4 py-2 rounded-full"
          style={{
            background: "rgba(10,10,20,0.55)",
            border: "1px solid rgba(108,71,255,0.28)",
            backdropFilter: "blur(12px)",
          }}
        >
          <StatPill label="screens" value={stats.uniqueScreens} />
          <Divider />
          <StatPill label="time" value={stats.elapsed} mono />
          <Divider />
          <StatPill label="coverage" value={`${coverage}%`} />
        </motion.div>

        <motion.button
          type="button"
          onClick={() => (jobId ? navigate(`/report/${jobId}`) : undefined)}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.45, duration: 0.4 }}
          className="mt-6 inline-flex items-center gap-2 px-6 py-3 rounded-full text-white font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-[#C9BBFF] focus-visible:ring-offset-2 focus-visible:ring-offset-[#0A0A14]"
          style={{
            fontFamily: "var(--font-heading)",
            background: "linear-gradient(120deg, #6C47FF 0%, #8A6CFF 50%, #DB2777 100%)",
            boxShadow: "0 0 32px rgba(108,71,255,0.32), 0 10px 40px -12px rgba(219,39,119,0.4)",
          }}
        >
          View Full Report
          <ArrowRight className="w-4 h-4" />
        </motion.button>
      </div>
    </motion.div>
  );
}

function StatPill({ label, value, mono }: { label: string; value: string | number; mono?: boolean }) {
  return (
    <div className="flex flex-col items-center">
      <span
        className="text-[15px] font-semibold text-white tabular-nums"
        style={{ fontFamily: mono ? "var(--font-mono)" : "var(--font-heading)" }}
      >
        {value}
      </span>
      <span
        className="text-[10px] uppercase tracking-[0.2em] text-white/50 mt-0.5"
        style={{ fontFamily: "var(--font-label)" }}
      >
        {label}
      </span>
    </div>
  );
}

function Divider() {
  return <span className="h-6 w-px bg-white/15" aria-hidden="true" />;
}
