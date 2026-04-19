import { motion, useReducedMotion } from "framer-motion";
import { Lock, EyeOff, Clock } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { EDITORIAL_EASE } from "../../report/tokens";

interface TrustItem {
  icon: LucideIcon;
  label: string;
  sublabel: string;
}

const ITEMS: TrustItem[] = [
  {
    icon: Lock,
    label: "Encrypted in transit",
    sublabel: "TLS 1.3 end-to-end",
  },
  {
    icon: EyeOff,
    label: "Never shared",
    sublabel: "Your build stays with you",
  },
  {
    icon: Clock,
    label: "Auto-deleted",
    sublabel: "Removed after 7 days",
  },
];

export function TrustStrip() {
  const reduceMotion = useReducedMotion();

  return (
    <motion.div
      initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 10 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-60px" }}
      transition={{ duration: 0.45, ease: EDITORIAL_EASE, delay: 0.08 }}
      className="grid grid-cols-1 sm:grid-cols-3 gap-3 md:gap-4"
    >
      {ITEMS.map(({ icon: Icon, label, sublabel }, idx) => (
        <motion.div
          key={label}
          initial={reduceMotion ? undefined : { opacity: 0, y: 6 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-60px" }}
          transition={{
            duration: 0.4,
            ease: EDITORIAL_EASE,
            delay: reduceMotion ? 0 : 0.12 + idx * 0.06,
          }}
          className="flex items-center gap-3 rounded-2xl px-4 py-3"
          style={{
            background:
              "linear-gradient(180deg, rgba(255,255,255,0.9) 0%, rgba(248,250,252,0.85) 100%)",
            border: "1px solid rgba(226,232,240,0.9)",
            boxShadow: "0 1px 2px rgba(15,23,42,0.03), 0 10px 24px -16px rgba(15,23,42,0.12)",
            backdropFilter: "blur(6px)",
          }}
        >
          <div
            className="shrink-0 w-8 h-8 rounded-[10px] flex items-center justify-center"
            style={{
              background:
                "linear-gradient(135deg, rgba(138,108,255,0.14) 0%, rgba(108,71,255,0.22) 100%)",
            }}
          >
            <Icon className="w-4 h-4 text-[var(--color-accent)]" strokeWidth={2} />
          </div>
          <div className="flex flex-col leading-tight min-w-0">
            <span
              className="text-[12px] font-semibold text-[var(--color-text-primary)]"
              style={{ fontFamily: "var(--font-label)", letterSpacing: "-0.005em" }}
            >
              {label}
            </span>
            <span
              className="text-[11.5px] text-[var(--color-text-muted)] truncate"
              style={{ fontFamily: "var(--font-sans)" }}
            >
              {sublabel}
            </span>
          </div>
        </motion.div>
      ))}
    </motion.div>
  );
}
