import { motion, useReducedMotion } from "framer-motion";
import { EDITORIAL_EASE } from "../../report/tokens";

interface UploadProgressRingProps {
  percent: number;
  size?: number;
  strokeWidth?: number;
  children?: React.ReactNode;
  tone?: "progress" | "success" | "error";
  label?: string;
}

export function UploadProgressRing({
  percent,
  size = 104,
  strokeWidth = 4,
  children,
  tone = "progress",
  label,
}: UploadProgressRingProps) {
  const reduceMotion = useReducedMotion();
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(100, percent));
  const offset = circumference - (clamped / 100) * circumference;

  const gradientId = `upload-ring-gradient-${tone}`;
  const stops = {
    progress: [
      { offset: "0%", color: "#8A6CFF" },
      { offset: "55%", color: "#6C47FF" },
      { offset: "100%", color: "#DB2777" },
    ],
    success: [
      { offset: "0%", color: "#10B981" },
      { offset: "100%", color: "#14B8A6" },
    ],
    error: [
      { offset: "0%", color: "#EF4444" },
      { offset: "100%", color: "#F59E0B" },
    ],
  }[tone];

  return (
    <div
      className="relative flex items-center justify-center"
      style={{ width: size, height: size }}
      role="progressbar"
      aria-valuenow={Math.round(clamped)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label ?? "Upload progress"}
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="absolute inset-0 -rotate-90"
      >
        <defs>
          <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="100%">
            {stops.map((s) => (
              <stop key={s.offset} offset={s.offset} stopColor={s.color} />
            ))}
          </linearGradient>
        </defs>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="#E2E8F0"
          strokeWidth={strokeWidth}
        />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={`url(#${gradientId})`}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          initial={reduceMotion ? { strokeDashoffset: offset } : { strokeDashoffset: circumference }}
          animate={{ strokeDashoffset: offset }}
          transition={
            reduceMotion
              ? { duration: 0 }
              : { duration: 0.35, ease: EDITORIAL_EASE }
          }
        />
      </svg>

      {children && (
        <div className="relative z-10 flex items-center justify-center">
          {children}
        </div>
      )}
    </div>
  );
}
