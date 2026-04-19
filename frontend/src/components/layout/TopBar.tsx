import { useHealth } from "../../api/hooks";
import { cn } from "../../lib/cn";

export function TopBar({ title }: { title: string }) {
  const { data: health } = useHealth();

  return (
    <header className="flex items-center justify-between px-4 sm:px-6 lg:px-8 py-4 border-b border-border-default bg-bg-secondary">
      <h2 className="text-lg font-semibold text-text-primary pl-10 lg:pl-0">{title}</h2>

      <div className="flex items-center gap-4">
        {health && (
          <div className="flex items-center gap-2">
            <div
              className={cn(
                "w-2 h-2 rounded-full",
                health.status === "ok" ? "bg-success animate-pulse-glow" : "bg-warning"
              )}
            />
            <span className="text-xs text-text-muted hidden sm:inline">
              {health.status === "ok" ? "Healthy" : "Degraded"}
            </span>
          </div>
        )}

        {health && (
          <span className="text-xs text-text-muted hidden md:inline">
            {health.memory.heap}MB heap
          </span>
        )}
      </div>
    </header>
  );
}
