import { motion, useReducedMotion, AnimatePresence } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { ArrowRight, Activity } from "lucide-react";
import { useJobStatus } from "../../../api/hooks";
import { EDITORIAL_EASE, REPORT_GRADIENTS } from "../../report/tokens";
import { UploadProgressRing } from "../../upload/components/UploadProgressRing";

interface LiveCrawlPulseProps {
  jobId: string | null;
}

const TERMINAL = new Set(["complete", "degraded", "failed"]);

export function LiveCrawlPulse({ jobId }: LiveCrawlPulseProps) {
  const navigate = useNavigate();
  const reduceMotion = useReducedMotion();
  const { data: job } = useJobStatus(jobId ?? undefined);

  const visible = !!jobId && !!job && !TERMINAL.has(job.status);

  const step = job?.step ?? 0;
  const totalSteps = job?.steps?.length ?? 6;
  const percent = totalSteps > 0 ? Math.min(100, Math.round((step / totalSteps) * 100)) : 0;
  const screens = job?.screenshots?.length ?? 0;
  const currentStepLabel = job?.steps?.[step] ?? "Working";

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          key={jobId}
          initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -8 }}
          transition={{ duration: 0.35, ease: EDITORIAL_EASE }}
          className="relative w-full rounded-[24px] p-4 md:p-5 flex items-center gap-4 md:gap-6"
          style={{
            background: REPORT_GRADIENTS.auroraTile,
            border: "1px solid rgba(108,71,255,0.28)",
            boxShadow:
              "0 2px 6px rgba(15,23,42,0.06), 0 20px 48px -24px rgba(108,71,255,0.22)",
          }}
          role="status"
          aria-live="polite"
        >
          <div className="shrink-0">
            <UploadProgressRing
              percent={percent}
              size={56}
              strokeWidth={3}
              tone="progress"
              label={`Analysis running — ${percent} percent`}
            >
              <div
                className="w-8 h-8 rounded-[12px] flex items-center justify-center"
                style={{
                  background: REPORT_GRADIENTS.scoreTrack,
                  boxShadow: "0 6px 18px -8px rgba(108,71,255,0.45)",
                }}
              >
                <Activity className="w-4 h-4 text-white" strokeWidth={2.5} />
              </div>
            </UploadProgressRing>
          </div>

          <div className="min-w-0 flex-1">
            <div
              className="text-[10.5px] font-semibold uppercase tracking-[0.22em] text-[var(--color-text-muted)]"
              style={{ fontFamily: "var(--font-label)" }}
            >
              Live analysis
            </div>
            <div
              className="mt-1 text-[15px] md:text-[16.5px] font-semibold text-[var(--color-text-primary)] truncate"
              style={{ fontFamily: "var(--font-mono)", letterSpacing: "-0.005em" }}
            >
              {currentStepLabel}
            </div>
            <div
              className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[12px] text-[var(--color-text-secondary)]"
              style={{ fontFamily: "var(--font-mono)" }}
            >
              <span>
                Step {step + 1}/{totalSteps}
              </span>
              <span className="text-[var(--color-border-hover)]">·</span>
              <span>{screens} screens</span>
            </div>
          </div>

          <button
            type="button"
            onClick={() => jobId && navigate(`/run/${jobId}`)}
            className="shrink-0 inline-flex items-center gap-1.5 px-4 py-2 rounded-full text-[12.5px] font-semibold text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent-ring)] transition-all hover:brightness-110"
            style={{
              background: REPORT_GRADIENTS.hero,
              fontFamily: "var(--font-sans)",
            }}
          >
            Jump to live
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
