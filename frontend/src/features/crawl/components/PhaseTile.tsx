import { AnimatePresence, motion } from "framer-motion";
import { TelemetryTile, type TelemetryVariant } from "./TelemetryTile";

interface PhaseTileProps {
  phase: string | null | undefined;
  activity: string | null | undefined;
  isTerminal?: boolean;
}

const PHASE_LABEL: Record<string, string> = {
  running: "Exploring",
  exploring: "Exploring",
  classifying: "Classifying",
  recovering: "Recovering",
  backtracking: "Back-tracking",
  initializing: "Booting",
  queued: "Queued",
  idle: "Idle",
  complete: "Complete",
  degraded: "Degraded",
  failed: "Failed",
};

const PHASE_SUBTITLE: Record<string, string> = {
  exploring: "Mapping user journeys",
  running: "Mapping user journeys",
  classifying: "Grouping screens by behavior",
  recovering: "Restoring nav state",
  backtracking: "Retrying a failed path",
  initializing: "Booting emulator",
  queued: "Awaiting emulator",
  idle: "Awaiting signal…",
  complete: "Finished",
  degraded: "Finished with gaps",
  failed: "Run halted",
};

const GRADIENT = "linear-gradient(120deg, #C9BBFF 0%, #8A6CFF 35%, #6C47FF 65%, #F472B6 100%)";

function mapVariant(phase: string | null | undefined): TelemetryVariant {
  if (!phase) return "default";
  const p = phase.toLowerCase();
  if (p.includes("recover")) return "warning";
  if (p.includes("fail")) return "danger";
  if (p === "complete") return "success";
  return "default";
}

export function PhaseTile({ phase, activity, isTerminal }: PhaseTileProps) {
  const key = (phase || "idle").toLowerCase();
  const label = PHASE_LABEL[key] || (phase ? phase.charAt(0).toUpperCase() + phase.slice(1) : "Idle");
  const variant = mapVariant(phase);
  const phaseSubtitle = PHASE_SUBTITLE[key];

  const subtitle = isTerminal
    ? phaseSubtitle || "Finished"
    : phaseSubtitle || (activity ? `Analyzing ${activity}` : "Awaiting signal…");

  return (
    <TelemetryTile overline="Phase" variant={variant}>
      <AnimatePresence mode="wait">
        <motion.div
          key={label}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.35, ease: [0.22, 0.61, 0.36, 1] }}
          className="text-[22px] leading-tight font-semibold"
          style={{
            fontFamily: "var(--font-heading)",
            background: GRADIENT,
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
            backgroundClip: "text",
            letterSpacing: "-0.01em",
          }}
        >
          {label}
        </motion.div>
      </AnimatePresence>
      <div className="mt-1 text-[12px] text-white/55 truncate" style={{ fontFamily: "var(--font-sans)" }}>
        {subtitle}
      </div>
    </TelemetryTile>
  );
}
