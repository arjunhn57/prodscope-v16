import { motion, useReducedMotion } from "framer-motion";
import type { LucideIcon } from "lucide-react";
import { AnimatedCounter } from "../../../components/shared/AnimatedCounter";
import { EDITORIAL_EASE, REPORT_GRADIENTS, TILE_STYLE } from "../../report/tokens";

interface MetricTileProps {
  label: string;
  icon: LucideIcon;
  value: number | string;
  sub?: string;
  prefix?: string;
  suffix?: string;
  decimals?: number;
  delay?: number;
  loading?: boolean;
}

export function MetricTile({
  label,
  icon: Icon,
  value,
  sub,
  prefix = "",
  suffix = "",
  decimals = 0,
  delay = 0,
  loading = false,
}: MetricTileProps) {
  const reduceMotion = useReducedMotion();
  const isString = typeof value === "string";

  return (
    <motion.div
      initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 12 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-60px" }}
      transition={{ duration: 0.45, ease: EDITORIAL_EASE, delay: reduceMotion ? 0 : delay }}
      className="relative w-full rounded-[20px] p-5 md:p-6 flex flex-col gap-4 h-full"
      style={TILE_STYLE}
    >
      <div className="flex items-start justify-between">
        <div
          className="text-[10.5px] font-semibold uppercase tracking-[0.22em] text-[var(--color-text-muted)]"
          style={{ fontFamily: "var(--font-label)" }}
        >
          {label}
        </div>
        <div
          className="w-10 h-10 rounded-[14px] flex items-center justify-center shrink-0"
          style={{
            background: REPORT_GRADIENTS.scoreTrack,
            boxShadow: "0 6px 18px -10px rgba(108,71,255,0.4)",
          }}
        >
          <Icon className="w-4.5 h-4.5 text-white" strokeWidth={2} />
        </div>
      </div>

      <div className="mt-auto">
        <div
          className="text-[32px] md:text-[36px] font-semibold text-[var(--color-text-primary)] leading-none tabular-nums"
          style={{ fontFamily: "var(--font-mono)", letterSpacing: "-0.02em" }}
        >
          {loading ? (
            <span className="inline-block h-8 w-24 rounded-md bg-[rgba(226,232,240,0.7)] animate-pulse" />
          ) : isString ? (
            <span>{value}</span>
          ) : (
            <AnimatedCounter
              value={value as number}
              prefix={prefix}
              suffix={suffix}
              decimals={decimals}
            />
          )}
        </div>
        {sub && !loading && (
          <div
            className="mt-2 text-[12.5px] text-[var(--color-text-secondary)]"
            style={{ fontFamily: "var(--font-sans)" }}
          >
            {sub}
          </div>
        )}
      </div>
    </motion.div>
  );
}
