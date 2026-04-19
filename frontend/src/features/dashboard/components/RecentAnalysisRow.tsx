import { useNavigate } from "react-router-dom";
import { motion, useReducedMotion } from "framer-motion";
import { Box, ArrowUpRight, RotateCcw } from "lucide-react";
import type { RecentJob } from "../../../api/hooks";
import { EDITORIAL_EASE, REPORT_GRADIENTS } from "../../report/tokens";
import { formatRelativeTime } from "../../../lib/format";
import { StatusBadge } from "../../../components/ui/Badge";

interface RecentAnalysisRowProps {
  job: RecentJob;
  isLive: boolean;
  delay?: number;
}

function pickStatus(job: RecentJob, isLive: boolean): typeof job.status {
  if (isLive) return "processing";
  if (job.status === "interrupted") return "failed";
  return job.status;
}

export function RecentAnalysisRow({ job, isLive, delay = 0 }: RecentAnalysisRowProps) {
  const navigate = useNavigate();
  const reduceMotion = useReducedMotion();

  const status = pickStatus(job, isLive);
  const title = job.appPackage || `Analysis ${job.jobId.slice(0, 8)}`;
  const meta = [
    formatRelativeTime(job.createdAt),
    job.stepsRun > 0 ? `${job.stepsRun} steps` : null,
    job.screensCaptured > 0 ? `${job.screensCaptured} screens` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const ctaLabel = isLive
    ? "Live"
    : status === "complete" || status === "degraded"
      ? "Report"
      : status === "failed"
        ? "Retry"
        : "Details";

  const ctaTarget = isLive
    ? `/run/${job.jobId}`
    : status === "complete" || status === "degraded"
      ? `/report/${job.jobId}`
      : status === "failed"
        ? "/upload"
        : `/report/${job.jobId}`;

  const ctaIsGradient = isLive;
  const Icon = status === "failed" ? RotateCcw : ArrowUpRight;

  return (
    <motion.div
      layout={!reduceMotion}
      initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: EDITORIAL_EASE, delay: reduceMotion ? 0 : delay }}
      className="group flex items-center gap-3 md:gap-4 py-3.5 px-3 md:px-4 rounded-2xl border border-transparent hover:border-[rgba(108,71,255,0.18)] hover:bg-white/60 transition-colors"
    >
      <div
        className="w-10 h-10 rounded-[14px] flex items-center justify-center shrink-0"
        style={{
          background: isLive ? REPORT_GRADIENTS.scoreTrack : REPORT_GRADIENTS.auroraTile,
          border: isLive ? "none" : "1px solid rgba(108,71,255,0.22)",
          boxShadow: isLive ? "0 6px 18px -8px rgba(108,71,255,0.45)" : undefined,
        }}
      >
        <Box
          className={`w-4.5 h-4.5 ${isLive ? "text-white" : "text-[var(--color-text-primary)]"}`}
          strokeWidth={2}
        />
      </div>

      <div className="min-w-0 flex-1">
        <div
          className="text-[13.5px] font-semibold text-[var(--color-text-primary)] truncate"
          style={{ fontFamily: "var(--font-mono)", letterSpacing: "-0.005em" }}
          title={title}
        >
          {title}
        </div>
        <div
          className="mt-0.5 text-[11.5px] text-[var(--color-text-muted)]"
          style={{ fontFamily: "var(--font-sans)" }}
        >
          {meta}
        </div>
      </div>

      <div className="shrink-0 hidden sm:block">
        <StatusBadge status={status} pulse={isLive} />
      </div>

      <button
        type="button"
        onClick={() => navigate(ctaTarget)}
        className={
          ctaIsGradient
            ? "shrink-0 inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-[11.5px] font-semibold text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent-ring)] transition-all hover:brightness-110"
            : "shrink-0 inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-[11.5px] font-medium text-[var(--color-text-secondary)] bg-white border border-[var(--color-border-default)] hover:border-[var(--color-border-hover)] hover:text-[var(--color-text-primary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent-ring)] transition-colors"
        }
        style={
          ctaIsGradient
            ? {
                background: REPORT_GRADIENTS.hero,
                fontFamily: "var(--font-sans)",
              }
            : { fontFamily: "var(--font-sans)" }
        }
        aria-label={`${ctaLabel} for ${title}`}
      >
        <Icon className="w-3 h-3" />
        {ctaLabel}
      </button>
    </motion.div>
  );
}
