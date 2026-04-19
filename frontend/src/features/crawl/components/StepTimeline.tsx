import { useMemo } from "react";
import { motion, useReducedMotion } from "framer-motion";

export type StepOutcome = "new" | "repeat" | "stuck" | "failed" | "pending";

interface StepTimelineProps {
  currentStep: number;
  maxSteps: number;
  outcomes: StepOutcome[];
}

const COLORS: Record<StepOutcome, string> = {
  new: "#6C47FF",
  repeat: "rgba(108,71,255,0.35)",
  stuck: "#F59E0B",
  failed: "#EF4444",
  pending: "#334155",
};

export function StepTimeline({ currentStep, maxSteps, outcomes }: StepTimelineProps) {
  const reduceMotion = useReducedMotion();
  const total = Math.max(8, maxSteps || outcomes.length || 80);

  const series: StepOutcome[] = useMemo(() => {
    const arr: StepOutcome[] = new Array(total).fill("pending");
    outcomes.slice(0, total).forEach((o, i) => {
      arr[i] = o;
    });
    return arr;
  }, [outcomes, total]);

  const pct = total > 0 ? Math.round((currentStep / total) * 100) : 0;
  const counts = series.reduce<Record<StepOutcome, number>>(
    (acc, o) => {
      acc[o] = (acc[o] || 0) + 1;
      return acc;
    },
    { new: 0, repeat: 0, stuck: 0, failed: 0, pending: 0 }
  );

  return (
    <section
      className="relative rounded-2xl px-5 py-4"
      style={{
        background: "linear-gradient(170deg, rgba(30, 27, 75, 0.42), rgba(18, 18, 43, 0.25))",
        border: "1px solid rgba(108, 71, 255, 0.14)",
        boxShadow:
          "0 20px 44px -12px rgba(0, 0, 0, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.06)",
        backdropFilter: "blur(14px)",
        WebkitBackdropFilter: "blur(14px)",
      }}
      aria-label="Step timeline"
    >
      <div className="flex items-baseline justify-between mb-2">
        <div
          className="text-[10px] uppercase tracking-[0.18em] text-white/55"
          style={{ fontFamily: "var(--font-label)" }}
        >
          Journey
        </div>
        <div
          className="text-[11px] text-white/55 tabular-nums"
          style={{ fontFamily: "var(--font-mono)" }}
        >
          Step {currentStep} / {total} · {pct}%
        </div>
      </div>

      {/* Mobile: compact outcome bar */}
      <div className="md:hidden">
        <div
          className="relative h-[8px] rounded-full overflow-hidden flex"
          style={{ background: "rgba(255,255,255,0.06)" }}
        >
          {(["new", "repeat", "failed"] as const).map((o) => {
            const c = counts[o];
            if (!c) return null;
            const width = `${(c / total) * 100}%`;
            return (
              <div
                key={o}
                style={{
                  width,
                  background: COLORS[o],
                  opacity: o === "new" ? 1 : 0.75,
                }}
              />
            );
          })}
        </div>
        <div
          className="mt-2 flex gap-3 text-[10px] text-white/55"
          style={{ fontFamily: "var(--font-mono)" }}
        >
          <span><span className="inline-block w-1.5 h-1.5 rounded-full mr-1 align-middle" style={{ background: COLORS.new }} />new {counts.new}</span>
          <span><span className="inline-block w-1.5 h-1.5 rounded-full mr-1 align-middle" style={{ background: COLORS.repeat }} />repeat {counts.repeat}</span>
          {counts.failed > 0 && (
            <span><span className="inline-block w-1.5 h-1.5 rounded-full mr-1 align-middle" style={{ background: COLORS.failed }} />failed {counts.failed}</span>
          )}
        </div>
      </div>

      {/* Desktop: dot ribbon */}
      <div className="hidden md:block">
        <div className="flex items-center gap-[2px] h-[10px] mt-2" style={{ minWidth: 0 }}>
          {series.map((o, i) => {
            const isCurrent = i === Math.min(total - 1, Math.max(0, currentStep - 1));
            const color = COLORS[o];
            return (
              <div
                key={i}
                className="relative flex-1 flex items-center justify-center"
                style={{ minWidth: 2 }}
                title={`Step ${i + 1} · ${o}`}
              >
                <motion.span
                  className="inline-block rounded-full"
                  style={{
                    width: isCurrent ? 8 : 5,
                    height: isCurrent ? 8 : 5,
                    background: color,
                    boxShadow: isCurrent ? `0 0 12px ${color}` : "none",
                  }}
                  animate={isCurrent && !reduceMotion ? { scale: [1, 1.3, 1] } : {}}
                  transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
                />
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
