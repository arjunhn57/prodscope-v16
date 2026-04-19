import { ArrowRight, Sparkles } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { cn } from "../../lib/cn";

type Variant = "inline" | "card" | "banner";
type Size = "sm" | "md" | "lg";

interface UpgradeCTAProps {
  variant?: Variant;
  size?: Size;
  className?: string;
  label?: string;
}

const sizeStyles: Record<Size, string> = {
  sm: "px-3 py-1.5 text-xs gap-1.5",
  md: "px-4 py-2 text-sm gap-2",
  lg: "px-6 py-3 text-base gap-2.5",
};

export function UpgradeCTA({
  variant = "inline",
  size = "md",
  className,
  label,
}: UpgradeCTAProps) {
  const navigate = useNavigate();
  const handleClick = () => navigate("/pricing");

  if (variant === "card") {
    return (
      <button
        onClick={handleClick}
        className={cn(
          "surface-card p-5 text-left transition-all duration-200 hover:shadow-md cursor-pointer group w-full",
          className
        )}
      >
        <div className="flex items-center gap-2 mb-2">
          <Sparkles className="w-4 h-4 text-accent" />
          <span className="text-sm font-semibold text-text-primary">
            {label || "Upgrade to Enterprise"}
          </span>
        </div>
        <p className="text-xs text-text-secondary mb-3">
          Unlock full reports, interactive app maps, and unlimited analyses.
        </p>
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-accent group-hover:gap-2 transition-all">
          See plans <ArrowRight className="w-3.5 h-3.5" />
        </span>
      </button>
    );
  }

  if (variant === "banner") {
    return (
      <div
        className={cn(
          "surface-accent flex items-center justify-between px-4 py-3",
          className
        )}
      >
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-accent" />
          <span className="text-sm text-text-primary">
            {label || "Upgrade for full access"}
          </span>
        </div>
        <button
          onClick={handleClick}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg accent-gradient text-text-on-accent cursor-pointer hover:brightness-110 transition-all"
        >
          Upgrade <ArrowRight className="w-3 h-3" />
        </button>
      </div>
    );
  }

  // inline (default)
  return (
    <button
      onClick={handleClick}
      className={cn(
        "inline-flex items-center font-medium rounded-xl cursor-pointer",
        "accent-gradient text-text-on-accent",
        "hover:brightness-110 active:brightness-95 transition-all duration-200",
        "shadow-[0_2px_8px_rgba(3,105,161,0.2)]",
        sizeStyles[size],
        className
      )}
    >
      <Sparkles className="w-3.5 h-3.5" />
      {label || "Upgrade"}
      <ArrowRight className="w-3.5 h-3.5" />
    </button>
  );
}
