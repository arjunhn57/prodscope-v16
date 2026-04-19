import { TelemetryTile } from "./TelemetryTile";

interface TileSkeletonProps {
  overline: string;
  variant?: "value" | "progress" | "phase";
}

export function TileSkeleton({ overline, variant = "value" }: TileSkeletonProps) {
  return (
    <TelemetryTile overline={overline}>
      {variant === "value" && (
        <>
          <div className="cinematic-shimmer" style={{ height: 18, width: "62%" }} aria-hidden="true" />
          <div
            className="cinematic-shimmer mt-2"
            style={{ height: 10, width: "86%", opacity: 0.7 }}
            aria-hidden="true"
          />
        </>
      )}
      {variant === "progress" && (
        <>
          <div className="cinematic-shimmer" style={{ height: 14, width: "40%" }} aria-hidden="true" />
          <div
            className="cinematic-shimmer mt-2"
            style={{ height: 22, width: "100%" }}
            aria-hidden="true"
          />
          <div
            className="cinematic-shimmer mt-2"
            style={{ height: 10, width: "70%", opacity: 0.7 }}
            aria-hidden="true"
          />
        </>
      )}
      {variant === "phase" && (
        <>
          <div className="cinematic-shimmer" style={{ height: 18, width: "48%" }} aria-hidden="true" />
          <div
            className="cinematic-shimmer mt-2"
            style={{ height: 10, width: "72%", opacity: 0.7 }}
            aria-hidden="true"
          />
        </>
      )}
      <span className="sr-only">Loading…</span>
    </TelemetryTile>
  );
}

export function TelemetryTilesSkeleton() {
  return (
    <>
      <TileSkeleton overline="Phase" variant="phase" />
      <TileSkeleton overline="Progress" variant="progress" />
      <TileSkeleton overline="Unique Screens" variant="value" />
      <TileSkeleton overline="Current Activity" variant="value" />
      <TileSkeleton overline="Session" variant="value" />
    </>
  );
}
