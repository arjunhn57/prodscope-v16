import { motion, useReducedMotion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { ArrowRight, Sparkles } from "lucide-react";
import { EDITORIAL_EASE, REPORT_GRADIENTS } from "../../report/tokens";

interface DashboardHeroProps {
  hasJobs: boolean;
  processing: boolean;
  lastJobReady: boolean;
  quotaExhausted: boolean;
}

export function DashboardHero({
  hasJobs,
  processing,
  lastJobReady,
  quotaExhausted,
}: DashboardHeroProps) {
  const navigate = useNavigate();
  const reduceMotion = useReducedMotion();

  const sub = quotaExhausted
    ? "You've hit this month's free quota — upgrade to keep shipping."
    : processing
      ? "An analysis is running. Watch it live."
      : lastJobReady
        ? "Your last analysis is ready."
        : "Ready when you are. Drop an APK to begin.";

  const primaryLabel = quotaExhausted ? "Upgrade to continue" : "New Analysis";
  const primaryTarget = quotaExhausted ? "/pricing" : "/upload";

  return (
    <motion.section
      initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: EDITORIAL_EASE }}
      className="text-center"
    >
      <div
        className="text-[10.5px] font-semibold uppercase tracking-[0.24em] text-[var(--color-text-muted)]"
        style={{ fontFamily: "var(--font-label)" }}
      >
        ProdScope · Command Center
      </div>

      <h1
        className="mt-4 text-[38px] sm:text-[48px] md:text-[56px] font-semibold text-[var(--color-text-primary)] leading-[1.04] max-w-[780px] mx-auto"
        style={{ fontFamily: "var(--font-heading)", letterSpacing: "-0.025em" }}
      >
        Welcome back.
      </h1>

      <p
        className="mt-5 text-[15.5px] md:text-[17px] text-[var(--color-text-secondary)] leading-[1.65] max-w-[560px] mx-auto"
        style={{ fontFamily: "var(--font-sans)" }}
      >
        {sub}
      </p>

      <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
        <button
          type="button"
          onClick={() => navigate(primaryTarget)}
          className="inline-flex items-center gap-2 px-6 py-3 rounded-full text-[14px] font-semibold text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent-ring)] transition-all hover:brightness-110 hover:shadow-[0_12px_32px_-12px_rgba(108,71,255,0.45)]"
          style={{
            background: REPORT_GRADIENTS.hero,
            boxShadow: "0 8px 24px -12px rgba(108,71,255,0.35)",
            fontFamily: "var(--font-sans)",
          }}
        >
          {quotaExhausted ? <Sparkles className="w-4 h-4" aria-hidden="true" /> : null}
          {primaryLabel}
          <ArrowRight className="w-4 h-4" aria-hidden="true" />
        </button>

        {hasJobs && (
          <button
            type="button"
            onClick={() => navigate("/history")}
            className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-full text-[13px] font-medium text-[var(--color-text-secondary)] bg-white/80 backdrop-blur border border-[var(--color-border-default)] hover:border-[var(--color-border-hover)] hover:text-[var(--color-text-primary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent-ring)] transition-colors"
            style={{ fontFamily: "var(--font-sans)" }}
          >
            View all reports
          </button>
        )}
      </div>
    </motion.section>
  );
}
