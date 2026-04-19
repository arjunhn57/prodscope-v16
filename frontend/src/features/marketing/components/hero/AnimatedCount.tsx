import { useEffect, useRef, useState } from "react";
import {
  animate,
  useInView,
  useMotionValue,
  useReducedMotion,
  useTransform,
  motion,
} from "framer-motion";

const DEFAULT_SEQUENCE = [47, 83, 12, 156] as const;

interface AnimatedCountProps {
  /** Sequence of integers the display cycles through. The first value is also the mount target. */
  sequence?: readonly number[];
  /** Interval in ms between re-rolls after the first count finishes. */
  rerollIntervalMs?: number;
  /** Duration of each count-up transition. */
  durationMs?: number;
  /** Optional className applied to the wrapping span. */
  className?: string;
  /** Inline style applied to the wrapping span. */
  style?: React.CSSProperties;
}

export function AnimatedCount({
  sequence = DEFAULT_SEQUENCE,
  rerollIntervalMs = 6000,
  durationMs = 1800,
  className,
  style,
}: AnimatedCountProps) {
  const prefersReducedMotion = useReducedMotion();
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.4 });

  const value = useMotionValue(prefersReducedMotion ? sequence[0] : 0);
  const display = useTransform(value, (latest) => Math.round(latest).toString());
  const [hasStarted, setHasStarted] = useState(false);

  // Initial count-up when entering viewport.
  useEffect(() => {
    if (prefersReducedMotion || !inView || hasStarted) return;
    setHasStarted(true);
    const controls = animate(value, sequence[0], {
      duration: durationMs / 1000,
      ease: [0.16, 1, 0.3, 1],
    });
    return () => controls.stop();
  }, [inView, prefersReducedMotion, sequence, value, durationMs, hasStarted]);

  // Re-roll cycle after the first count finishes.
  useEffect(() => {
    if (prefersReducedMotion || !hasStarted) return;
    let index = 0;
    const id = window.setInterval(() => {
      index = (index + 1) % sequence.length;
      animate(value, sequence[index], {
        duration: durationMs / 1000,
        ease: [0.16, 1, 0.3, 1],
      });
    }, rerollIntervalMs);
    return () => window.clearInterval(id);
  }, [hasStarted, prefersReducedMotion, sequence, value, durationMs, rerollIntervalMs]);

  return (
    <motion.span
      ref={ref}
      className={className}
      style={{ display: "inline-block", fontVariantNumeric: "tabular-nums", ...style }}
    >
      {display}
    </motion.span>
  );
}
