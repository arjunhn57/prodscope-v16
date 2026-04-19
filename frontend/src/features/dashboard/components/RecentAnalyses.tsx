import { useMemo } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { useRecentJobs, type RecentJob } from "../../../api/hooks";
import { EDITORIAL_EASE, REPORT_GRADIENTS } from "../../report/tokens";
import { RecentAnalysisRow } from "./RecentAnalysisRow";
import { RecentAnalysesEmpty } from "./RecentAnalysesEmpty";

interface RecentAnalysesProps {
  liveJobId: string | null;
  limit?: number;
}

export function RecentAnalyses({ liveJobId, limit = 5 }: RecentAnalysesProps) {
  const navigate = useNavigate();
  const reduceMotion = useReducedMotion();
  const { data, isLoading } = useRecentJobs(Math.max(limit, 5));

  const sortedItems = useMemo(() => {
    const items: RecentJob[] = data?.items ?? [];
    if (!liveJobId) return items.slice(0, limit);
    // Pin the live job to the top regardless of created_at
    const live = items.find((j) => j.jobId === liveJobId);
    const rest = items.filter((j) => j.jobId !== liveJobId);
    const combined = live ? [live, ...rest] : items;
    return combined.slice(0, limit);
  }, [data, liveJobId, limit]);

  const totalCount = data?.items.length ?? 0;
  const isEmpty = !isLoading && sortedItems.length === 0;

  return (
    <motion.div
      initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 14 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-60px" }}
      transition={{ duration: 0.45, ease: EDITORIAL_EASE }}
      className="relative w-full rounded-[28px] overflow-hidden"
      style={{
        background: REPORT_GRADIENTS.auroraTile,
        border: "1px solid rgba(108,71,255,0.22)",
        boxShadow:
          "0 2px 6px rgba(15,23,42,0.05), 0 28px 56px -28px rgba(108,71,255,0.22)",
      }}
    >
      <header className="flex items-center justify-between px-6 md:px-7 pt-6 pb-4">
        <div className="flex items-center gap-3">
          <h2
            className="text-[10.5px] font-semibold uppercase tracking-[0.22em] text-[var(--color-text-muted)]"
            style={{ fontFamily: "var(--font-label)" }}
          >
            Recent analyses
          </h2>
          {totalCount > 0 && (
            <span
              className="inline-flex items-center justify-center min-w-[22px] h-[22px] px-2 rounded-full text-[10.5px] font-semibold text-[var(--color-text-secondary)] bg-white border border-[var(--color-border-default)]"
              style={{ fontFamily: "var(--font-mono)" }}
            >
              {totalCount}
            </span>
          )}
        </div>
        {totalCount > 0 && (
          <button
            type="button"
            onClick={() => navigate("/history")}
            className="inline-flex items-center gap-1 text-[12px] font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent-ring)] rounded"
            style={{ fontFamily: "var(--font-sans)" }}
          >
            View all
            <ArrowRight className="w-3 h-3" />
          </button>
        )}
      </header>

      <div className="px-3 md:px-4 pb-3 md:pb-4 max-h-[520px] overflow-y-auto">
        {isLoading ? (
          <div className="space-y-2 py-2 px-2">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="flex items-center gap-4 py-3.5 px-2 rounded-2xl"
              >
                <div className="w-10 h-10 rounded-[14px] bg-[rgba(226,232,240,0.7)] animate-pulse" />
                <div className="flex-1 space-y-2">
                  <div className="h-3.5 w-40 rounded bg-[rgba(226,232,240,0.7)] animate-pulse" />
                  <div className="h-3 w-56 rounded bg-[rgba(226,232,240,0.5)] animate-pulse" />
                </div>
                <div className="h-6 w-20 rounded-full bg-[rgba(226,232,240,0.7)] animate-pulse" />
              </div>
            ))}
          </div>
        ) : isEmpty ? (
          <RecentAnalysesEmpty />
        ) : (
          <div className="divide-y divide-[rgba(226,232,240,0.55)]">
            {sortedItems.map((job, i) => (
              <RecentAnalysisRow
                key={job.jobId}
                job={job}
                isLive={job.jobId === liveJobId}
                delay={0.04 * i}
              />
            ))}
          </div>
        )}
      </div>
    </motion.div>
  );
}
