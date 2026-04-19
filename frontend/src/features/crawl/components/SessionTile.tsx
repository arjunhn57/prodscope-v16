import { useEffect, useState } from "react";
import { useReducedMotion } from "framer-motion";
import { TelemetryTile } from "./TelemetryTile";

interface SessionTileProps {
  startedAt: number | null;
  step: number;
  maxSteps: number;
  isTerminal?: boolean;
}

function mmss(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const mm = Math.floor(totalSec / 60).toString().padStart(2, "0");
  const ss = (totalSec % 60).toString().padStart(2, "0");
  return `${mm}:${ss}`;
}

export function SessionTile({ startedAt, step, maxSteps, isTerminal }: SessionTileProps) {
  const reduceMotion = useReducedMotion();
  const [now, setNow] = useState(() => Date.now());
  const [frozenElapsed, setFrozenElapsed] = useState<number | null>(null);
  const [colonOn, setColonOn] = useState(true);

  useEffect(() => {
    if (isTerminal) {
      if (startedAt && frozenElapsed === null) setFrozenElapsed(Date.now() - startedAt);
      return;
    }
    if (!startedAt) return;
    const id = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(id);
  }, [startedAt, isTerminal, frozenElapsed]);

  useEffect(() => {
    if (isTerminal || !startedAt || reduceMotion) {
      setColonOn(true);
      return;
    }
    const id = window.setInterval(() => setColonOn((v) => !v), 500);
    return () => window.clearInterval(id);
  }, [startedAt, isTerminal, reduceMotion]);

  const elapsedMs = frozenElapsed ?? (startedAt ? now - startedAt : 0);
  const elapsed = mmss(elapsedMs);
  const [mm, ss] = elapsed.split(":");

  const showEta = !isTerminal && startedAt && step >= 5 && maxSteps > 0;
  let etaLabel: string | null = null;
  if (showEta) {
    const avgMs = elapsedMs / step;
    const remainingMs = avgMs * Math.max(0, maxSteps - step);
    const capped = Math.min(remainingMs, 15 * 60 * 1000);
    etaLabel = remainingMs > capped ? "> 15:00" : mmss(capped);
  }

  const footer = isTerminal
    ? `Finished at step ${step} / ${maxSteps}`
    : etaLabel
      ? `Target: ${maxSteps} steps · ETA ${etaLabel}`
      : `Target: ${maxSteps} steps · measuring pace…`;

  return (
    <TelemetryTile overline="Session">
      <div
        className="text-[20px] tabular-nums text-white/90"
        style={{ fontFamily: "var(--font-mono)", letterSpacing: "0.02em" }}
        aria-label={`Elapsed ${elapsed}`}
      >
        {mm}
        <span
          style={{
            opacity: colonOn ? 1 : 0.25,
            transition: "opacity 220ms ease-out",
          }}
        >:</span>
        {ss}
      </div>
      <div className="mt-1 text-[11px] text-white/50" style={{ fontFamily: "var(--font-sans)" }}>
        {footer}
      </div>
    </TelemetryTile>
  );
}
