import { motion, useMotionValue, useSpring, useTransform } from "framer-motion";
import { useEffect } from "react";

interface ScoreRingProps {
  score: number;
  size?: number;
  label?: string;
}

function getScoreColor(score: number): string {
  if (score >= 80) return "var(--m-success)";
  if (score >= 60) return "var(--m-accent)";
  if (score >= 40) return "var(--m-warning)";
  return "var(--m-danger)";
}

function getScoreGrade(score: number): string {
  if (score >= 90) return "Excellent";
  if (score >= 75) return "Good";
  if (score >= 60) return "Fair";
  if (score >= 40) return "Needs Work";
  return "Poor";
}

export function ScoreRing({ score, size = 160, label = "Quality Score" }: ScoreRingProps) {
  const strokeWidth = 8;
  const radius = (size - strokeWidth * 2) / 2;
  const circumference = 2 * Math.PI * radius;

  const progress = useMotionValue(0);
  const springProgress = useSpring(progress, { stiffness: 60, damping: 20 });
  const dashOffset = useTransform(springProgress, (v) => circumference * (1 - v / 100));

  const displayScore = useSpring(useMotionValue(0), { stiffness: 60, damping: 20 });

  useEffect(() => {
    progress.set(score);
    displayScore.set(score);
  }, [score, progress, displayScore]);

  const color = getScoreColor(score);
  const grade = getScoreGrade(score);

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
      <div style={{ position: "relative", width: size, height: size }}>
        {/* Track */}
        <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="var(--m-bg-muted)"
            strokeWidth={strokeWidth}
          />
          <motion.circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={color}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeDasharray={circumference}
            style={{ strokeDashoffset: dashOffset }}
          />
        </svg>

        {/* Center text */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <motion.span
            style={{
              fontSize: size * 0.25,
              fontWeight: 700,
              color: "var(--m-text)",
              letterSpacing: "-0.03em",
              lineHeight: 1,
            }}
          >
            {Math.round(score)}
          </motion.span>
          <span
            style={{
              fontSize: 12,
              fontWeight: 500,
              color,
              marginTop: 4,
            }}
          >
            {grade}
          </span>
        </div>
      </div>

      <span
        style={{
          fontSize: 13,
          fontWeight: 500,
          color: "var(--m-text-secondary)",
          letterSpacing: "0.01em",
        }}
      >
        {label}
      </span>
    </div>
  );
}
