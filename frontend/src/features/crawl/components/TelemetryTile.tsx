import type { ReactNode } from "react";

export type TelemetryVariant = "default" | "warning" | "danger" | "success";

interface TelemetryTileProps {
  overline?: string;
  children: ReactNode;
  variant?: TelemetryVariant;
  className?: string;
}

const variantBorder: Record<TelemetryVariant, string> = {
  default: "rgba(108, 71, 255, 0.18)",
  warning: "rgba(245, 158, 11, 0.35)",
  danger: "rgba(239, 68, 68, 0.35)",
  success: "rgba(16, 185, 129, 0.28)",
};

export function TelemetryTile({
  overline,
  children,
  variant = "default",
  className = "",
}: TelemetryTileProps) {
  return (
    <div
      className={`relative rounded-2xl px-4 py-3.5 ${className}`}
      style={{
        background:
          "linear-gradient(170deg, rgba(30, 27, 75, 0.50), rgba(18, 18, 43, 0.30))",
        border: `1px solid ${variantBorder[variant]}`,
        boxShadow:
          "0 20px 44px -12px rgba(0, 0, 0, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.08), inset 0 0 0 1px rgba(108, 71, 255, 0.04)",
        backdropFilter: "blur(14px)",
        WebkitBackdropFilter: "blur(14px)",
      }}
    >
      {overline && (
        <div
          className="text-[10px] uppercase tracking-[0.18em] text-white/50 mb-1.5"
          style={{ fontFamily: "var(--font-label)" }}
        >
          {overline}
        </div>
      )}
      {children}
    </div>
  );
}
