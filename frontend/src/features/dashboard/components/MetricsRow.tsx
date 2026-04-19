import { Scan, Layers, Sparkles, TrendingUp, Crown } from "lucide-react";
import { MetricTile } from "./MetricTile";
import { useAuthStore } from "../../../stores/auth";
import type { HealthData } from "../../../api/hooks";

interface MetricsRowProps {
  health: HealthData | undefined;
}

export function MetricsRow({ health }: MetricsRowProps) {
  const tier = useAuthStore((s) => s.tier);
  const usage = useAuthStore((s) => s.usage);
  const loading = !health;

  const thisMonthValue: number | string =
    tier === "enterprise"
      ? "Unlimited"
      : `${usage.crawlsThisMonth} / ${usage.crawlLimit}`;

  const thisMonthSub =
    tier === "enterprise"
      ? "Enterprise access"
      : usage.crawlsThisMonth >= usage.crawlLimit
        ? "Quota reached this month"
        : `${usage.crawlLimit - usage.crawlsThisMonth} remaining`;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-5">
      <MetricTile
        label="Total analyses"
        icon={Scan}
        value={health?.metrics.totalCrawls ?? 0}
        loading={loading}
        delay={0}
      />
      <MetricTile
        label="Screens captured"
        icon={Layers}
        value={health?.metrics.totalScreensCaptured ?? 0}
        loading={loading}
        delay={0.06}
      />
      <MetricTile
        label="Vision insights"
        icon={Sparkles}
        value={health?.metrics.totalVisionCalls ?? 0}
        loading={loading}
        delay={0.12}
      />
      <MetricTile
        label="This month"
        icon={tier === "enterprise" ? Crown : TrendingUp}
        value={thisMonthValue}
        sub={thisMonthSub}
        loading={false}
        delay={0.18}
      />
    </div>
  );
}
