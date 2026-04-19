import { TelemetryTile } from "./TelemetryTile";

interface ActivityTileProps {
  activity: string | null | undefined;
  intentType: string | null | undefined;
  isTerminal?: boolean;
}

export function ActivityTile({ activity, intentType, isTerminal }: ActivityTileProps) {
  const fallback = isTerminal ? "—" : "waiting";
  const chipLabel = intentType || (isTerminal ? "final" : "unknown");
  return (
    <TelemetryTile overline={isTerminal ? "Last Activity" : "Current Activity"}>
      <div
        className="text-[11px] text-white/80 truncate"
        style={{ fontFamily: "var(--font-mono)" }}
        title={activity || fallback}
      >
        {activity || fallback}
      </div>
      <div className="mt-2 flex items-center gap-2">
        <span
          className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px]"
          style={{
            fontFamily: "var(--font-sans)",
            fontWeight: 500,
            color: isTerminal ? "rgba(201,187,255,0.75)" : "#C9BBFF",
            background: "rgba(108, 71, 255, 0.14)",
            border: "1px solid rgba(108, 71, 255, 0.25)",
          }}
        >
          {chipLabel.charAt(0).toUpperCase() + chipLabel.slice(1)}
        </span>
      </div>
    </TelemetryTile>
  );
}
