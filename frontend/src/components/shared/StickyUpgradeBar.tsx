import { Sparkles, ArrowRight, X } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { cn } from "../../lib/cn";
import { useAuthStore } from "../../stores/auth";

interface StickyUpgradeBarProps {
  className?: string;
  message?: string;
}

export function StickyUpgradeBar({
  className,
  message = "Unlock Full Report",
}: StickyUpgradeBarProps) {
  const tier = useAuthStore((s) => s.tier);
  const navigate = useNavigate();
  const [dismissed, setDismissed] = useState(false);

  if (tier !== "free" || dismissed) return null;

  return (
    <div
      className={cn(
        "fixed bottom-0 left-0 right-0 z-50 lg:left-[220px]",
        "border-t border-border-default",
        "bg-bg-secondary shadow-lg",
        className
      )}
    >
      <div className="max-w-5xl mx-auto flex items-center justify-between px-5 py-3">
        <div className="flex items-center gap-3">
          <Sparkles className="w-4.5 h-4.5 text-accent" />
          <span className="text-sm text-text-primary font-medium">
            {message}
          </span>
          <span className="text-sm text-text-secondary hidden sm:inline">
            — $100/month for unlimited access
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => navigate("/pricing")}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-xl accent-gradient text-text-on-accent cursor-pointer hover:brightness-110 transition-all shadow-sm"
          >
            Upgrade Now <ArrowRight className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => setDismissed(true)}
            className="p-2 text-text-muted hover:text-text-primary transition-colors cursor-pointer"
            aria-label="Dismiss"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
