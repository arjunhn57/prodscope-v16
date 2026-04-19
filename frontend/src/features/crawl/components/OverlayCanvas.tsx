import { AnimatePresence, motion, useReducedMotion } from "framer-motion";

export interface PerceptionBox {
  description: string;
  x: number;
  y: number;
  priority?: number;
}

export interface TapTarget {
  x: number;
  y: number;
  element: string;
}

interface OverlayCanvasProps {
  /** Rendered image width in px (scaled to fit bezel). */
  width: number;
  /** Rendered image height in px. */
  height: number;
  /** Native emulator width (usually 1080). */
  emulatorWidth: number;
  /** Native emulator height (usually 2340 or similar). */
  emulatorHeight: number;
  boxes: PerceptionBox[];
  tapTarget: TapTarget | null;
  /** Stage: controls which visual layer is emphasized. */
  stage: "awareness" | "decision" | "action" | "idle";
  /** Arbitrary key that changes each tap — used to re-trigger ripple. */
  actionKey?: string | number | null;
}

const ACCENT = "#6C47FF";

export function OverlayCanvas({
  width,
  height,
  emulatorWidth,
  emulatorHeight,
  boxes,
  tapTarget,
  stage,
  actionKey,
}: OverlayCanvasProps) {
  const reduceMotion = useReducedMotion();
  if (width <= 0 || height <= 0) return null;
  const sx = width / Math.max(1, emulatorWidth);
  const sy = height / Math.max(1, emulatorHeight);
  const BOX_W = 48 * sx;
  const BOX_H = 48 * sy;

  const sortedBoxes = [...boxes].sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99)).slice(0, 5);

  const selected = tapTarget
    ? sortedBoxes.findIndex(
        (b) => Math.hypot(b.x - tapTarget.x, b.y - tapTarget.y) < 72
      )
    : -1;

  const showBoxes = stage !== "idle";
  const showReticle = (stage === "decision" || stage === "action") && tapTarget;
  const showRipple = stage === "action" && tapTarget;

  return (
    <svg
      className="absolute inset-0 pointer-events-none"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden="true"
    >
      <AnimatePresence>
        {showBoxes &&
          sortedBoxes.map((b, i) => {
            const cx = b.x * sx;
            const cy = b.y * sy;
            const x = cx - BOX_W / 2;
            const y = cy - BOX_H / 2;
            const isSelected = i === selected;
            const dim = stage === "decision" && !isSelected;
            return (
              <motion.g
                key={`${b.x}-${b.y}-${i}`}
                initial={{ opacity: 0, scale: reduceMotion ? 1 : 0.92 }}
                animate={{ opacity: dim ? 0.25 : 1, scale: 1 }}
                exit={{ opacity: 0, transition: { duration: 0.18 } }}
                transition={{ delay: reduceMotion ? 0 : i * 0.06, duration: 0.26, ease: [0.22, 0.61, 0.36, 1] }}
                style={{ transformOrigin: `${cx}px ${cy}px` }}
              >
                <rect
                  x={x}
                  y={y}
                  width={BOX_W}
                  height={BOX_H}
                  rx={8}
                  ry={8}
                  fill={isSelected ? "rgba(108,71,255,0.22)" : "rgba(108,71,255,0.08)"}
                  stroke={isSelected ? ACCENT : "rgba(108,71,255,0.55)"}
                  strokeWidth={isSelected ? 2 : 1}
                  strokeDasharray={isSelected ? "0" : "6 4"}
                  style={isSelected ? { filter: "drop-shadow(0 0 10px rgba(108,71,255,0.7))" } : undefined}
                />
                <text
                  x={x + 6}
                  y={Math.max(10, y - 4)}
                  fontSize={10}
                  fontFamily="var(--font-mono, monospace)"
                  fill={isSelected ? "#F5F3FF" : "rgba(255,255,255,0.78)"}
                >
                  {String(i + 1).padStart(2, "0")}
                </text>
              </motion.g>
            );
          })}
      </AnimatePresence>

      {showReticle && tapTarget && !reduceMotion && (
        <g transform={`translate(${tapTarget.x * sx}, ${tapTarget.y * sy})`}>
          {[12, 22, 34].map((r, i) => (
            <motion.circle
              key={`ring-${r}-${actionKey}`}
              cx={0}
              cy={0}
              r={r}
              fill="none"
              stroke={ACCENT}
              strokeWidth={1.25}
              initial={{ opacity: 0.9, scale: 0.6 }}
              animate={{ opacity: 0, scale: 1.4 }}
              transition={{ duration: 0.55, delay: i * 0.1, ease: "easeOut" }}
            />
          ))}
        </g>
      )}

      {showRipple && tapTarget && !reduceMotion && (
        <motion.circle
          key={`ripple-${actionKey}`}
          cx={tapTarget.x * sx}
          cy={tapTarget.y * sy}
          r={0}
          fill={ACCENT}
          initial={{ r: 0, opacity: 0.5 }}
          animate={{ r: 56, opacity: 0 }}
          transition={{ duration: 0.32, ease: "easeOut" }}
        />
      )}
    </svg>
  );
}
