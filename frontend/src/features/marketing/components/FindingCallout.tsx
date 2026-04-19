import { motion, useReducedMotion } from "framer-motion";
import { AlertTriangle, CheckCircle2, type LucideIcon } from "lucide-react";
import type { CSSProperties } from "react";

export type FindingVariant = "bug" | "coverage";

interface FindingCalloutProps {
  variant: FindingVariant;
  label: string;
  body: string;
  timestamp: string;
  /** Inline style (used for absolute positioning in Hero). */
  style?: CSSProperties;
  className?: string;
  /** Delay before the card enters (seconds). */
  delay?: number;
}

interface VariantConfig {
  Icon: LucideIcon;
  iconColor: string;
  labelColor: string;
  iconBg: string;
  ring: string;
}

const VARIANTS: Record<FindingVariant, VariantConfig> = {
  bug: {
    Icon: AlertTriangle,
    iconColor: "#EF4444",
    labelColor: "#B91C1C",
    iconBg: "linear-gradient(135deg, rgba(254, 226, 226, 0.95), rgba(254, 202, 202, 0.75))",
    ring: "rgba(239, 68, 68, 0.22)",
  },
  coverage: {
    Icon: CheckCircle2,
    iconColor: "#10B981",
    labelColor: "#047857",
    iconBg: "linear-gradient(135deg, rgba(209, 250, 229, 0.95), rgba(167, 243, 208, 0.75))",
    ring: "rgba(16, 185, 129, 0.22)",
  },
};

const BASE_STYLE: CSSProperties = {
  background: "rgba(255, 255, 255, 0.72)",
  border: "1px solid rgba(124, 58, 237, 0.10)",
  borderRadius: 16,
  padding: "14px 16px",
  backdropFilter: "blur(20px) saturate(1.4)",
  WebkitBackdropFilter: "blur(20px) saturate(1.4)",
  boxShadow: [
    "0 20px 40px -12px rgba(124, 58, 237, 0.14)",
    "0 8px 16px -4px rgba(124, 58, 237, 0.08)",
    "inset 0 1px 0 rgba(255, 255, 255, 0.9)",
  ].join(", "),
  minWidth: 260,
  maxWidth: 300,
};

export function FindingCallout({
  variant,
  label,
  body,
  timestamp,
  style,
  className,
  delay = 0,
}: FindingCalloutProps) {
  const prefersReducedMotion = useReducedMotion();
  const cfg = VARIANTS[variant];
  const Icon = cfg.Icon;

  return (
    <motion.div
      initial={prefersReducedMotion ? false : { opacity: 0, y: 12, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{
        type: "spring",
        damping: 18,
        stiffness: 220,
        delay: prefersReducedMotion ? 0 : delay,
      }}
      className={className}
      style={{ ...BASE_STYLE, ...style }}
    >
      <div className="flex items-start gap-3">
        <div
          className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full"
          style={{
            background: cfg.iconBg,
            boxShadow: `0 0 0 1px ${cfg.ring}, inset 0 1px 0 rgba(255, 255, 255, 0.85)`,
          }}
        >
          <Icon className="h-4 w-4" strokeWidth={2.4} style={{ color: cfg.iconColor }} />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-3">
            <span
              className="text-[10.5px] font-semibold uppercase tracking-[0.14em]"
              style={{
                color: cfg.labelColor,
                fontFamily: "var(--font-label)",
              }}
            >
              {label}
            </span>
            <span
              className="text-[10px] whitespace-nowrap"
              style={{
                color: "#94A3B8",
                fontFamily: "var(--font-mono)",
                letterSpacing: "0.02em",
              }}
            >
              {timestamp}
            </span>
          </div>
          <p
            className="mt-1 text-[13px] leading-[1.45]"
            style={{
              color: "#1A1A2E",
              fontFamily: "var(--font-sans)",
              fontWeight: 500,
            }}
          >
            {body}
          </p>
        </div>
      </div>
    </motion.div>
  );
}
