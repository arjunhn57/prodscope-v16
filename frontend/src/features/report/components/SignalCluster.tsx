import { motion, useReducedMotion } from "framer-motion";
import type { ScoreBreakdown } from "../types";
import {
  REPORT_GRADIENTS,
  REPORT_SURFACES,
  SECTION_IDS,
  EDITORIAL_EASE,
} from "../tokens";

interface SignalClusterProps {
  score: ScoreBreakdown;
}

interface AxisSpec {
  key: keyof Omit<ScoreBreakdown, "overall">;
  label: string;
  qualifier: (score: number) => string;
}

const AXES: AxisSpec[] = [
  {
    key: "stability",
    label: "Stability",
    qualifier: (s) => (s >= 85 ? "Clean" : s >= 60 ? "Stable" : s >= 40 ? "Shaky" : "Blocking"),
  },
  {
    key: "ux",
    label: "UX",
    qualifier: (s) => (s >= 85 ? "Refined" : s >= 60 ? "Solid" : s >= 40 ? "Rough" : "Poor"),
  },
  {
    key: "coverage",
    label: "Coverage",
    qualifier: (s) => (s >= 85 ? "Broad" : s >= 60 ? "Adequate" : s >= 40 ? "Thin" : "Shallow"),
  },
  {
    key: "performance",
    label: "Performance",
    qualifier: (s) => (s >= 85 ? "Snappy" : s >= 60 ? "Responsive" : s >= 40 ? "Sluggish" : "Slow"),
  },
];

export function SignalCluster({ score }: SignalClusterProps) {
  const reduceMotion = useReducedMotion();
  const size = 160;
  const strokeWidth = 10;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score.overall / 100) * circumference;

  return (
    <section
      id={SECTION_IDS.signals}
      className="py-12 md:py-16 border-b border-[var(--color-border-subtle)]"
    >
      <motion.div
        initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 12 }}
        whileInView={reduceMotion ? { opacity: 1 } : { opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-60px" }}
        transition={{ duration: 0.5, ease: EDITORIAL_EASE }}
        className="grid md:grid-cols-[auto_1fr] gap-10 items-center"
      >
        <div
          className="relative mx-auto md:mx-0"
          style={{
            width: size,
            height: size,
            background: REPORT_GRADIENTS.auroraTile,
            borderRadius: "50%",
            padding: 10,
            border: "1px solid rgba(108,71,255,0.22)",
            boxShadow: REPORT_SURFACES.shadowSoft,
          }}
        >
          <svg
            width={size - 20}
            height={size - 20}
            style={{ transform: "rotate(-90deg)" }}
          >
            <defs>
              <linearGradient id="score-ring-gradient" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#6C47FF" />
                <stop offset="60%" stopColor="#8A6CFF" />
                <stop offset="100%" stopColor="#DB2777" />
              </linearGradient>
            </defs>
            <circle
              cx={(size - 20) / 2}
              cy={(size - 20) / 2}
              r={radius}
              fill="none"
              stroke="#EEF0F5"
              strokeWidth={strokeWidth}
            />
            <motion.circle
              cx={(size - 20) / 2}
              cy={(size - 20) / 2}
              r={radius}
              fill="none"
              stroke="url(#score-ring-gradient)"
              strokeWidth={strokeWidth}
              strokeLinecap="round"
              strokeDasharray={circumference}
              initial={reduceMotion ? { strokeDashoffset: offset } : { strokeDashoffset: circumference }}
              whileInView={{ strokeDashoffset: offset }}
              viewport={{ once: true, margin: "-40px" }}
              transition={{
                duration: reduceMotion ? 0 : 1.1,
                ease: EDITORIAL_EASE,
                delay: reduceMotion ? 0 : 0.15,
              }}
            />
          </svg>

          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span
              className="text-[44px] font-semibold text-[var(--color-text-primary)] leading-none"
              style={{ fontFamily: "var(--font-heading)", letterSpacing: "-0.03em" }}
            >
              {score.overall}
            </span>
            <span className="mt-1 text-[11px] text-[var(--color-text-muted)] tracking-wide">
              / 100
            </span>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {AXES.map((axis, i) => {
            const val = score[axis.key];
            return (
              <motion.div
                key={axis.key}
                initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 8 }}
                whileInView={reduceMotion ? { opacity: 1 } : { opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{
                  duration: 0.4,
                  delay: reduceMotion ? 0 : 0.15 + i * 0.08,
                  ease: EDITORIAL_EASE,
                }}
                className="px-4 py-4 rounded-2xl"
                style={{
                  background: REPORT_GRADIENTS.auroraTile,
                  border: "1px solid rgba(108,71,255,0.12)",
                  boxShadow: REPORT_SURFACES.shadowSoft,
                }}
              >
                <div
                  className="text-[10.5px] font-semibold uppercase tracking-[0.2em] text-[var(--color-text-muted)]"
                  style={{ fontFamily: "var(--font-label)" }}
                >
                  {axis.label}
                </div>
                <div className="mt-2 flex items-baseline gap-2">
                  <span
                    className="text-[26px] font-semibold text-[var(--color-text-primary)] leading-none tabular-nums"
                    style={{ fontFamily: "var(--font-heading)", letterSpacing: "-0.02em" }}
                  >
                    {val}
                  </span>
                  <span className="text-[12px] text-[var(--color-text-muted)]">
                    {axis.qualifier(val)}
                  </span>
                </div>
                <AxisBar value={val} />
              </motion.div>
            );
          })}
        </div>
      </motion.div>
    </section>
  );
}

function AxisBar({ value }: { value: number }) {
  const reduceMotion = useReducedMotion();
  const tone =
    value >= 80 ? "#10B981" : value >= 60 ? "#6C47FF" : value >= 40 ? "#F59E0B" : "#EF4444";

  return (
    <div
      className="mt-3 h-1 w-full rounded-full overflow-hidden"
      style={{ background: "#EEF0F5" }}
    >
      <motion.div
        className="h-full rounded-full"
        style={{ background: tone }}
        initial={reduceMotion ? { width: `${value}%` } : { width: 0 }}
        whileInView={{ width: `${value}%` }}
        viewport={{ once: true }}
        transition={{ duration: reduceMotion ? 0 : 0.8, ease: EDITORIAL_EASE }}
      />
    </div>
  );
}
