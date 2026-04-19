import { useEffect, useState } from "react";
import { Clock } from "lucide-react";
import { cn } from "../../lib/cn";

interface ExpiryCountdownProps {
  /** ISO date string when the report expires */
  expiresAt: string;
  className?: string;
}

function getTimeRemaining(expiresAt: string): {
  expired: boolean;
  days: number;
  hours: number;
  minutes: number;
} {
  const diff = new Date(expiresAt).getTime() - Date.now();

  if (diff <= 0) {
    return { expired: true, days: 0, hours: 0, minutes: 0 };
  }

  return {
    expired: false,
    days: Math.floor(diff / (1000 * 60 * 60 * 24)),
    hours: Math.floor((diff / (1000 * 60 * 60)) % 24),
    minutes: Math.floor((diff / (1000 * 60)) % 60),
  };
}

export function ExpiryCountdown({ expiresAt, className }: ExpiryCountdownProps) {
  const [remaining, setRemaining] = useState(() => getTimeRemaining(expiresAt));

  useEffect(() => {
    const interval = setInterval(() => {
      setRemaining(getTimeRemaining(expiresAt));
    }, 60_000);
    return () => clearInterval(interval);
  }, [expiresAt]);

  if (remaining.expired) {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1.5 px-2 py-1 text-xs font-medium rounded-lg bg-danger/10 text-danger",
          className
        )}
      >
        <Clock className="w-3 h-3" />
        Expired
      </span>
    );
  }

  const isUrgent = remaining.days < 2;
  const label =
    remaining.days > 0
      ? `${remaining.days}d ${remaining.hours}h`
      : `${remaining.hours}h ${remaining.minutes}m`;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 px-2 py-1 text-xs font-medium rounded-lg",
        isUrgent
          ? "bg-warning/10 text-warning animate-pulse-glow"
          : "bg-text-muted/10 text-text-muted",
        className
      )}
    >
      <Clock className="w-3 h-3" />
      Expires in {label}
    </span>
  );
}
