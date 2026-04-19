import { motion } from "framer-motion";
import { Shield, Lock, ScrollText } from "lucide-react";
import { EDITORIAL_EASE } from "../../report/tokens";

const CHIPS = [
  { icon: Shield, label: "AES-256 encryption" },
  { icon: Lock, label: "GDPR-compliant" },
  { icon: ScrollText, label: "SOC 2 in progress" },
] as const;

export function AuthTrustStrip() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.2, ease: EDITORIAL_EASE }}
      className="w-full max-w-[440px] flex flex-col items-center gap-3"
    >
      <div className="flex flex-wrap items-center justify-center gap-2">
        {CHIPS.map((chip) => (
          <div
            key={chip.label}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full"
            style={{
              background: "rgba(255,255,255,0.82)",
              border: "1px solid rgba(108,71,255,0.16)",
              boxShadow: "0 1px 2px rgba(15,23,42,0.03)",
            }}
          >
            <chip.icon className="w-3 h-3 text-accent" aria-hidden />
            <span
              className="text-[10.5px] uppercase text-text-secondary"
              style={{
                fontFamily: "var(--font-label)",
                letterSpacing: "0.14em",
              }}
            >
              {chip.label}
            </span>
          </div>
        ))}
      </div>
      <p
        className="text-[11.5px] text-text-muted text-center"
        style={{ fontFamily: "var(--font-mono)", letterSpacing: "0.02em" }}
      >
        2,847 findings &middot; 142 apps &middot; 15-min reports
      </p>
    </motion.div>
  );
}
