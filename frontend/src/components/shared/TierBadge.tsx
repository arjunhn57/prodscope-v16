import { cn } from "../../lib/cn";
import { useAuthStore, type Tier } from "../../stores/auth";

interface TierBadgeProps {
  tier?: Tier;
  className?: string;
}

export function TierBadge({ tier: tierProp, className }: TierBadgeProps) {
  const storeTier = useAuthStore((s) => s.tier);
  const tier = tierProp ?? storeTier;

  if (tier === "enterprise") {
    return (
      <span
        className={cn(
          "inline-flex items-center px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded-md",
          "bg-accent-glow text-accent",
          className
        )}
      >
        Enterprise
      </span>
    );
  }

  if (tier === "pro") {
    return (
      <span
        className={cn(
          "inline-flex items-center px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded-md",
          "bg-accent-glow text-accent",
          className
        )}
      >
        Pro
      </span>
    );
  }

  return (
    <span
      className={cn(
        "inline-flex items-center px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider rounded-md",
        "bg-bg-tertiary text-text-muted",
        className
      )}
    >
      Free
    </span>
  );
}
