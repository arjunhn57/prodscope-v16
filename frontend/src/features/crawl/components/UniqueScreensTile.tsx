import { useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { TelemetryTile } from "./TelemetryTile";

interface UniqueScreensTileProps {
  count: number;
}

const GRADIENT = "linear-gradient(120deg, #C9BBFF 0%, #8A6CFF 35%, #6C47FF 65%, #F472B6 100%)";

export function UniqueScreensTile({ count }: UniqueScreensTileProps) {
  const reduceMotion = useReducedMotion();
  const prev = useRef(count);
  const [pulse, setPulse] = useState(false);

  useEffect(() => {
    if (count > prev.current && !reduceMotion) {
      setPulse(true);
      const t = window.setTimeout(() => setPulse(false), 500);
      prev.current = count;
      return () => window.clearTimeout(t);
    }
    prev.current = count;
  }, [count, reduceMotion]);

  return (
    <TelemetryTile overline="Unique Screens">
      <div className="relative">
        <motion.div
          className="text-[44px] leading-none tabular-nums"
          style={{
            fontFamily: "var(--font-heading)",
            fontWeight: 700,
            background: GRADIENT,
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
            backgroundClip: "text",
            letterSpacing: "-0.03em",
          }}
          animate={pulse ? { scale: [1, 1.08, 1] } : { scale: 1 }}
          transition={{ duration: 0.4, ease: [0.22, 0.61, 0.36, 1] }}
        >
          {count}
        </motion.div>
        {pulse && (
          <motion.div
            className="pointer-events-none absolute -inset-2 rounded-full"
            initial={{ opacity: 0.7, boxShadow: "0 0 0 0 rgba(108,71,255,0.0)" }}
            animate={{ opacity: 0, boxShadow: "0 0 32px 4px rgba(108,71,255,0.45)" }}
            transition={{ duration: 0.5, ease: "easeOut" }}
          />
        )}
      </div>
      <div className="mt-1 text-[11px] text-white/50" style={{ fontFamily: "var(--font-sans)" }}>
        Discovered so far
      </div>
    </TelemetryTile>
  );
}
