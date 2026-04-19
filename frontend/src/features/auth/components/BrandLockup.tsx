import { motion } from "framer-motion";
import { BarChart3 } from "lucide-react";
import { EDITORIAL_EASE } from "../../report/tokens";

export function BrandLockup() {
  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: EDITORIAL_EASE }}
      className="flex flex-col items-center gap-3"
    >
      <div
        className="w-11 h-11 rounded-2xl flex items-center justify-center"
        style={{
          background: "rgba(239,235,255,0.9)",
          border: "1px solid rgba(108,71,255,0.22)",
          boxShadow: "0 1px 2px rgba(15,23,42,0.04), 0 8px 24px -12px rgba(108,71,255,0.18)",
        }}
      >
        <BarChart3 className="w-5 h-5 text-accent" />
      </div>
      <div className="text-center">
        <h1
          className="text-[22px] font-bold text-text-primary leading-none"
          style={{
            fontFamily: "var(--font-heading)",
            letterSpacing: "-0.02em",
          }}
        >
          ProdScope
        </h1>
        <p
          className="mt-1 text-[10.5px] text-text-muted uppercase"
          style={{
            fontFamily: "var(--font-label)",
            letterSpacing: "0.22em",
          }}
        >
          AI-Powered App Analysis
        </p>
      </div>
    </motion.div>
  );
}
