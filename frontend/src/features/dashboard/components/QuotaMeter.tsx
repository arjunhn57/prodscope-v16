import { useNavigate } from "react-router-dom";
import { motion, useReducedMotion } from "framer-motion";
import { ArrowRight, Crown } from "lucide-react";
import { useAuthStore } from "../../../stores/auth";
import {
  ACCENT_PANEL_STYLE,
  EDITORIAL_EASE,
  REPORT_GRADIENTS,
  TILE_STYLE,
} from "../../report/tokens";

const RING_SIZE = 88;
const RING_STROKE = 8;
const RING_RADIUS = (RING_SIZE - RING_STROKE) / 2;
const RING_CIRCUM = 2 * Math.PI * RING_RADIUS;

export function QuotaMeter() {
  const navigate = useNavigate();
  const reduceMotion = useReducedMotion();
  const tier = useAuthStore((s) => s.tier);
  const usage = useAuthStore((s) => s.usage);

  if (tier === "enterprise") {
    return (
      <motion.section
        initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 14 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-60px" }}
        transition={{ duration: 0.45, ease: EDITORIAL_EASE, delay: reduceMotion ? 0 : 0.08 }}
        className="relative w-full rounded-[24px] p-5 md:p-6"
        style={ACCENT_PANEL_STYLE}
      >
        <div className="flex items-center gap-3">
          <div
            className="w-11 h-11 rounded-[14px] flex items-center justify-center shrink-0"
            style={{
              background: REPORT_GRADIENTS.hero,
              boxShadow: "0 8px 24px -10px rgba(108,71,255,0.5)",
            }}
          >
            <Crown className="w-5 h-5 text-white" strokeWidth={2} />
          </div>
          <div className="min-w-0 flex-1">
            <div
              className="text-[10.5px] font-semibold uppercase tracking-[0.22em] text-[var(--color-text-muted)]"
              style={{ fontFamily: "var(--font-label)" }}
            >
              Plan
            </div>
            <div
              className="mt-1 text-[17px] font-semibold text-[var(--color-text-primary)]"
              style={{ fontFamily: "var(--font-heading)", letterSpacing: "-0.01em" }}
            >
              Enterprise
            </div>
          </div>
        </div>

        <p
          className="mt-3 text-[13px] text-[var(--color-text-secondary)] leading-[1.55]"
          style={{ fontFamily: "var(--font-sans)" }}
        >
          Unlimited analyses, priority queue, and full findings exports.
        </p>
      </motion.section>
    );
  }

  const { crawlsThisMonth, crawlLimit } = usage;
  const used = Math.min(crawlsThisMonth, crawlLimit);
  const remaining = Math.max(0, crawlLimit - crawlsThisMonth);
  const pct = crawlLimit > 0 ? Math.min(100, (crawlsThisMonth / crawlLimit) * 100) : 0;
  const offset = RING_CIRCUM - (pct / 100) * RING_CIRCUM;
  const exhausted = crawlsThisMonth >= crawlLimit;

  return (
    <motion.section
      initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 14 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-60px" }}
      transition={{ duration: 0.45, ease: EDITORIAL_EASE, delay: reduceMotion ? 0 : 0.08 }}
      className="relative w-full rounded-[24px] p-5 md:p-6"
      style={TILE_STYLE}
    >
      <div className="flex items-start gap-4">
        <div
          className="shrink-0"
          aria-label={`${used} of ${crawlLimit} analyses used this month`}
          role="img"
        >
          <svg
            width={RING_SIZE}
            height={RING_SIZE}
            viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`}
            className="-rotate-90"
          >
            <defs>
              <linearGradient id="quota-ring-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor={exhausted ? "#EF4444" : "#6C47FF"} />
                <stop offset="50%" stopColor={exhausted ? "#F59E0B" : "#8A6CFF"} />
                <stop offset="100%" stopColor={exhausted ? "#DB2777" : "#DB2777"} />
              </linearGradient>
            </defs>
            <circle
              cx={RING_SIZE / 2}
              cy={RING_SIZE / 2}
              r={RING_RADIUS}
              fill="none"
              stroke="rgba(226,232,240,0.8)"
              strokeWidth={RING_STROKE}
            />
            <motion.circle
              cx={RING_SIZE / 2}
              cy={RING_SIZE / 2}
              r={RING_RADIUS}
              fill="none"
              stroke="url(#quota-ring-gradient)"
              strokeWidth={RING_STROKE}
              strokeLinecap="round"
              strokeDasharray={RING_CIRCUM}
              initial={{ strokeDashoffset: reduceMotion ? offset : RING_CIRCUM }}
              animate={{ strokeDashoffset: offset }}
              transition={{
                duration: reduceMotion ? 0 : 0.7,
                ease: EDITORIAL_EASE,
                delay: reduceMotion ? 0 : 0.2,
              }}
            />
          </svg>
        </div>

        <div className="min-w-0 flex-1">
          <div
            className="text-[10.5px] font-semibold uppercase tracking-[0.22em] text-[var(--color-text-muted)]"
            style={{ fontFamily: "var(--font-label)" }}
          >
            This month
          </div>
          <div
            className="mt-1 text-[22px] font-semibold text-[var(--color-text-primary)] tabular-nums"
            style={{ fontFamily: "var(--font-mono)", letterSpacing: "-0.01em" }}
          >
            {used} <span className="text-[var(--color-text-muted)]">/ {crawlLimit}</span>
          </div>
          <div
            className="mt-0.5 text-[12px] text-[var(--color-text-secondary)]"
            style={{ fontFamily: "var(--font-sans)" }}
          >
            {exhausted
              ? "Quota reached — upgrade to continue."
              : `${remaining} remaining this month.`}
          </div>
        </div>
      </div>

      <button
        type="button"
        onClick={() => navigate("/pricing")}
        className="mt-4 w-full inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-full text-[12.5px] font-semibold text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent-ring)] transition-all hover:brightness-110"
        style={{
          background: REPORT_GRADIENTS.hero,
          fontFamily: "var(--font-sans)",
        }}
      >
        Go unlimited
        <ArrowRight className="w-3.5 h-3.5" />
      </button>
    </motion.section>
  );
}
