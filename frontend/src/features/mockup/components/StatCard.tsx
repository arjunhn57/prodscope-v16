import { motion, useMotionValue, useSpring, useTransform } from "framer-motion";
import type { ReactNode, MouseEvent } from "react";

interface StatCardProps {
  label: string;
  value: string;
  change?: string;
  trend?: "up" | "down" | "neutral";
  icon: ReactNode;
}

export function StatCard({ label, value, change, trend = "neutral", icon }: StatCardProps) {
  const x = useMotionValue(0);
  const y = useMotionValue(0);

  const rotateX = useSpring(useTransform(y, [-100, 100], [4, -4]), { stiffness: 300, damping: 30 });
  const rotateY = useSpring(useTransform(x, [-100, 100], [-4, 4]), { stiffness: 300, damping: 30 });

  function handleMouse(e: MouseEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    x.set(e.clientX - rect.left - rect.width / 2);
    y.set(e.clientY - rect.top - rect.height / 2);
  }

  function handleLeave() {
    x.set(0);
    y.set(0);
  }

  const trendColor =
    trend === "up"
      ? "var(--m-success)"
      : trend === "down"
        ? "var(--m-danger)"
        : "var(--m-text-muted)";

  const trendBg =
    trend === "up"
      ? "var(--m-success-bg)"
      : trend === "down"
        ? "var(--m-danger-bg)"
        : "var(--m-bg-muted)";

  const trendArrow = trend === "up" ? "\u2191" : trend === "down" ? "\u2193" : "";

  return (
    <motion.div
      onMouseMove={handleMouse}
      onMouseLeave={handleLeave}
      style={{
        rotateX,
        rotateY,
        transformStyle: "preserve-3d",
        perspective: 800,
      }}
      className="group cursor-default"
    >
      <div
        style={{
          background: "var(--m-bg-white)",
          border: "1px solid var(--m-border)",
          borderRadius: "var(--m-radius-lg)",
          boxShadow: "var(--m-shadow-3d)",
          padding: "24px",
          transition: "box-shadow 0.3s ease, border-color 0.3s ease",
        }}
        className="group-hover:shadow-[0_12px_32px_rgba(0,0,0,0.08)]"
      >
        {/* Icon + Label row */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
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
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: "var(--m-radius-md)",
              background: "var(--m-bg-muted)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--m-text-secondary)",
              transform: "translateZ(20px)",
            }}
          >
            {icon}
          </div>
        </div>

        {/* Value */}
        <div
          style={{
            fontSize: 32,
            fontWeight: 700,
            color: "var(--m-text)",
            lineHeight: 1.1,
            letterSpacing: "-0.02em",
            marginBottom: 8,
            transform: "translateZ(12px)",
          }}
        >
          {value}
        </div>

        {/* Trend */}
        {change && (
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span
              style={{
                fontSize: 12,
                fontWeight: 600,
                color: trendColor,
                background: trendBg,
                padding: "2px 8px",
                borderRadius: 6,
              }}
            >
              {trendArrow} {change}
            </span>
            <span style={{ fontSize: 12, color: "var(--m-text-muted)" }}>vs last week</span>
          </div>
        )}
      </div>
    </motion.div>
  );
}
