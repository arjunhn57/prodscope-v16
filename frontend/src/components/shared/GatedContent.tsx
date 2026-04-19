import { type ReactNode } from "react";
import { Lock } from "lucide-react";
import { cn } from "../../lib/cn";
import { useAuthStore, canAccessFeature, type GatedFeature } from "../../stores/auth";
import { UpgradeCTA } from "./UpgradeCTA";

interface GatedContentProps {
  feature: GatedFeature;
  children: ReactNode;
  label?: string;
  className?: string;
  forceGated?: boolean;
}

export function GatedContent({
  feature,
  children,
  label = "Enterprise Feature",
  className,
  forceGated,
}: GatedContentProps) {
  const tier = useAuthStore((s) => s.tier);
  const gated = forceGated ?? !canAccessFeature(tier, feature);

  if (!gated) {
    return <>{children}</>;
  }

  return (
    <div className={cn("relative", className)}>
      {/* Blurred content underneath */}
      <div className="content-locked select-none pointer-events-none" aria-hidden>
        {children}
      </div>

      {/* Lock overlay */}
      <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3">
        <div className="w-10 h-10 rounded-full bg-bg-secondary shadow-md flex items-center justify-center border border-border-default">
          <Lock className="w-4.5 h-4.5 text-text-muted" />
        </div>
        <p className="text-sm font-medium text-text-secondary">{label}</p>
        <UpgradeCTA variant="inline" size="sm" />
      </div>
    </div>
  );
}
