import { motion, useReducedMotion, AnimatePresence } from "framer-motion";
import { AlertTriangle, ArrowRight } from "lucide-react";
import { EDITORIAL_EASE } from "../../report/tokens";

interface DegradedRibbonProps {
  visible: boolean;
}

export function DegradedRibbon({ visible }: DegradedRibbonProps) {
  const reduceMotion = useReducedMotion();

  return (
    <AnimatePresence>
      {visible && (
        <motion.a
          href="#system-pulse"
          initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -6 }}
          transition={{ duration: 0.35, ease: EDITORIAL_EASE }}
          className="group relative w-full rounded-full px-4 py-2 flex items-center justify-center gap-2 text-[12.5px] font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent-ring)] transition-colors"
          style={{
            background: "linear-gradient(120deg, #FFFBEB 0%, #FEF3C7 100%)",
            border: "1px solid rgba(245,158,11,0.35)",
            color: "#B45309",
            fontFamily: "var(--font-sans)",
          }}
          role="status"
          aria-live="polite"
        >
          <AlertTriangle className="w-3.5 h-3.5" strokeWidth={2} />
          <span>Some services are degraded.</span>
          <span className="inline-flex items-center gap-0.5 font-semibold">
            See status
            <ArrowRight className="w-3 h-3 transition-transform group-hover:translate-x-0.5" />
          </span>
        </motion.a>
      )}
    </AnimatePresence>
  );
}
