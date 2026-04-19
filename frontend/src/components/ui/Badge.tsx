import { cn } from "../../lib/cn";
import { JOB_STATUSES, type JobStatus } from "../../lib/constants";

interface BadgeProps {
  status: JobStatus;
  className?: string;
  pulse?: boolean;
}

export function StatusBadge({ status, className, pulse }: BadgeProps) {
  const config = JOB_STATUSES[status] ?? JOB_STATUSES.failed;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-full transition-colors duration-300",
        config.bg,
        config.color,
        className
      )}
    >
      <span
        className={cn(
          "w-1.5 h-1.5 rounded-full",
          config.dot,
          pulse && status === "processing" && "animate-pulse"
        )}
      />
      {config.label}
    </span>
  );
}
