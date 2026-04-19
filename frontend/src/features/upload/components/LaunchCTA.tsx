import { motion, useReducedMotion } from "framer-motion";
import { ArrowRight, Loader2 } from "lucide-react";
import { EDITORIAL_EASE, REPORT_GRADIENTS } from "../../report/tokens";

interface LaunchCTAProps {
  ready: boolean;
  submitting?: boolean;
  onClick: () => void;
  hint?: string;
}

export function LaunchCTA({ ready, submitting = false, onClick, hint }: LaunchCTAProps) {
  const reduceMotion = useReducedMotion();
  const disabled = !ready || submitting;

  return (
    <div className="flex flex-col items-center gap-2.5">
      <motion.button
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-disabled={disabled}
        animate={
          reduceMotion || !ready || submitting
            ? { scale: 1 }
            : { scale: [1, 1.02, 1] }
        }
        transition={
          reduceMotion || !ready || submitting
            ? { duration: 0 }
            : { duration: 2.4, ease: EDITORIAL_EASE, repeat: Infinity }
        }
        whileHover={!disabled && !reduceMotion ? { scale: 1.02 } : undefined}
        whileTap={!disabled && !reduceMotion ? { scale: 0.98 } : undefined}
        className="group relative inline-flex items-center justify-center gap-2.5 rounded-full px-7 py-3.5 text-[14px] font-semibold text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent-ring)] focus-visible:ring-offset-2 disabled:cursor-not-allowed transition-[opacity,box-shadow] duration-300"
        style={{
          background: ready ? REPORT_GRADIENTS.hero : "#CBD5E1",
          fontFamily: "var(--font-sans)",
          letterSpacing: "-0.005em",
          boxShadow: ready
            ? "0 8px 24px -10px rgba(108,71,255,0.55), 0 2px 6px rgba(15,23,42,0.08)"
            : "0 1px 2px rgba(15,23,42,0.05)",
          opacity: disabled ? (submitting ? 0.9 : 0.6) : 1,
        }}
      >
        {submitting ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" strokeWidth={2.5} />
            Starting…
          </>
        ) : (
          <>
            Start Analysis
            <ArrowRight
              className="w-4 h-4 transition-transform duration-300 group-hover:translate-x-0.5"
              strokeWidth={2.5}
            />
          </>
        )}
      </motion.button>
      {hint && (
        <div
          className="text-[11.5px] text-[var(--color-text-muted)]"
          style={{ fontFamily: "var(--font-sans)" }}
        >
          {hint}
        </div>
      )}
    </div>
  );
}
