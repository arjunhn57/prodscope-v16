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

// Freemium constant — public users get 1 report on signup. Used as the ring's
// denominator so visual fill mirrors the credit-spent ratio.
const FREE_QUOTA = 1;

export function QuotaMeter() {
  const navigate = useNavigate();
  const reduceMotion = useReducedMotion();
  const tier = useAuthStore((s) => s.tier);
  const user = useAuthStore((s) => s.user);

  // Exempt users (admin, design_partner) see the Enterprise tile regardless
  // of stored credits.
  const exempt = user?.quotaExempt === true || tier === "enterprise";

  if (exempt) {
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

  // Freemium: render against credits_remaining from the backend. Default to
  // 1 (the free signup grant) if the field hasn't synced yet — matches the
  // server-side default in jobs/store.js.
  const creditsRemaining =
    typeof user?.creditsRemaining === "number" ? user.creditsRemaining : FREE_QUOTA;
  const used = Math.max(0, FREE_QUOTA - creditsRemaining);
  const remaining = Math.max(0, creditsRemaining);
  const pct = FREE_QUOTA > 0 ? Math.min(100, (used / FREE_QUOTA) * 100) : 0;
  const offset = RING_CIRCUM - (pct / 100) * RING_CIRCUM;
  const exhausted = remaining <= 0;

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
          aria-label={`${used} of ${FREE_QUOTA} free reports used`}
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
            Free reports
          </div>
          <div
            className="mt-1 text-[22px] font-semibold text-[var(--color-text-primary)] tabular-nums"
            style={{ fontFamily: "var(--font-mono)", letterSpacing: "-0.01em" }}
          >
            {remaining} <span className="text-[var(--color-text-muted)]">/ {FREE_QUOTA}</span>
          </div>
          <div
            className="mt-0.5 text-[12px] text-[var(--color-text-secondary)]"
            style={{ fontFamily: "var(--font-sans)" }}
          >
            {exhausted
              ? "Free report used — upgrade to run another."
              : remaining === 1
                ? "1 free report remaining."
                : `${remaining} free reports remaining.`}
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
        {exhausted ? "Upgrade to run another report" : "Go unlimited"}
        <ArrowRight className="w-3.5 h-3.5" />
      </button>
    </motion.section>
  );
}
