import { Lock } from "lucide-react";
import { cn } from "../../lib/cn";
import { UpgradeCTA } from "./UpgradeCTA";

interface CountTeaseProps {
  visibleCount: number;
  totalCount: number;
  itemLabel: string;
  skeletonCount?: number;
  className?: string;
}

export function CountTease({
  visibleCount,
  totalCount,
  itemLabel,
  skeletonCount = 3,
  className,
}: CountTeaseProps) {
  const hiddenCount = totalCount - visibleCount;

  if (hiddenCount <= 0) return null;

  return (
    <div className={cn("space-y-3", className)}>
      {/* Locked skeleton cards */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: Math.min(skeletonCount, hiddenCount) }).map(
          (_, i) => (
            <LockedCard key={i} />
          )
        )}
      </div>

      {/* Count label + upgrade */}
      <div className="flex items-center justify-between bg-bg-tertiary border border-border-default px-4 py-3 rounded-xl">
        <p className="text-sm text-text-secondary">
          Viewing{" "}
          <span className="text-text-primary font-medium">{visibleCount}</span>{" "}
          of{" "}
          <span className="text-text-primary font-medium">{totalCount}</span>{" "}
          {itemLabel}
        </p>
        <UpgradeCTA
          variant="inline"
          size="sm"
          label={`Unlock ${hiddenCount} more`}
        />
      </div>
    </div>
  );
}

export function LockedCard({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "bg-bg-tertiary border border-border-default p-4 rounded-xl flex flex-col items-center justify-center gap-2 min-h-[100px] opacity-60",
        className
      )}
    >
      <div className="w-8 h-8 rounded-full bg-bg-secondary shadow-sm flex items-center justify-center border border-border-default">
        <Lock className="w-3.5 h-3.5 text-text-muted" />
      </div>
      <div className="space-y-1.5 w-full">
        <div className="skeleton h-3 w-3/4 mx-auto" />
        <div className="skeleton h-2 w-1/2 mx-auto" />
      </div>
    </div>
  );
}
