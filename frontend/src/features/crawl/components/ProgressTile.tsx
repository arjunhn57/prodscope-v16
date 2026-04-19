import { useEffect, useMemo, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { TelemetryTile } from "./TelemetryTile";

interface ProgressTileProps {
  step: number;
  maxSteps: number;
  avgSecPerStep: number | null;
}

const SEGMENTS = 80;

export function ProgressTile({ step, maxSteps, avgSecPerStep }: ProgressTileProps) {
  const reduceMotion = useReducedMotion();
  const totalSegments = Math.max(1, maxSteps || SEGMENTS);
  const filled = Math.min(totalSegments, Math.max(0, step));
  const pct = Math.round((filled / totalSegments) * 100);
  const [pulseIdx, setPulseIdx] = useState<number | null>(null);

  useEffect(() => {
    if (reduceMotion) return;
    if (filled <= 0) return;
    setPulseIdx(filled - 1);
    const t = window.setTimeout(() => setPulseIdx(null), 280);
    return () => window.clearTimeout(t);
  }, [filled, reduceMotion]);

  const segments = useMemo(() => new Array(totalSegments).fill(0), [totalSegments]);

  const showAvg = filled >= 5 && avgSecPerStep !== null && avgSecPerStep > 0;
  const footer = filled <= 0
    ? "0% complete · awaiting first step"
    : showAvg
      ? `${pct}% complete · avg ${avgSecPerStep!.toFixed(1)}s/step`
      : `${pct}% complete · measuring pace…`;

  return (
    <TelemetryTile overline="Progress">
      <div className="flex items-baseline justify-between mb-2">
        <div className="text-[13px] text-white/90 tabular-nums" style={{ fontFamily: "var(--font-mono)" }}>
          {filled} <span className="text-white/40">/</span> {totalSegments}
          <span className="text-white/40 font-normal"> steps</span>
        </div>
      </div>
      <div
        className="flex items-end gap-[2px] h-[22px]"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={totalSegments}
        aria-valuenow={filled}
        aria-label="Analysis progress"
      >
        {segments.map((_, i) => {
          const isFilled = i < filled;
          const isPulsing = i === pulseIdx;
          return (
            <motion.span
              key={i}
              className="flex-1 rounded-[2px]"
              style={{
                height: "100%",
                background: isFilled
                  ? "linear-gradient(180deg, #A78BFA 0%, #6C47FF 70%, #DB2777 100%)"
                  : "rgba(255,255,255,0.06)",
                opacity: 1,
              }}
              animate={isPulsing ? { opacity: [0.8, 1, 1], filter: ["brightness(1.4)", "brightness(1)"] } : {}}
              transition={{ duration: 0.28, ease: "easeOut" }}
            />
          );
        })}
      </div>
      <div className="mt-2 text-[11px] text-white/55" style={{ fontFamily: "var(--font-sans)" }}>
        {footer}
      </div>
    </TelemetryTile>
  );
}
