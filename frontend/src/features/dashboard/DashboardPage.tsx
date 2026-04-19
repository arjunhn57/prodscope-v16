import { TopBar } from "../../components/layout/TopBar";
import { StickyUpgradeBar } from "../../components/shared/StickyUpgradeBar";
import {
  useHealth,
  useQueueStatus,
  useRecentJobs,
} from "../../api/hooks";
import { useAuthStore } from "../../stores/auth";
import { DashboardHero } from "./components/DashboardHero";
import { DegradedRibbon } from "./components/DegradedRibbon";
import { LiveCrawlPulse } from "./components/LiveCrawlPulse";
import { MetricsRow } from "./components/MetricsRow";
import { RecentAnalyses } from "./components/RecentAnalyses";
import { SystemPulse } from "./components/SystemPulse";
import { QuotaMeter } from "./components/QuotaMeter";

const PAGE_BG = [
  "radial-gradient(80% 50% at 50% 0%, rgba(108,71,255,0.08) 0%, rgba(108,71,255,0) 55%)",
  "radial-gradient(60% 50% at 50% 0%, rgba(219,39,119,0.05) 0%, rgba(219,39,119,0) 60%)",
  "#FAFAFA",
].join(", ");

export function DashboardPage() {
  const { data: health } = useHealth();
  const { data: queue } = useQueueStatus();
  const { data: recent } = useRecentJobs(10);
  const tier = useAuthStore((s) => s.tier);
  const usage = useAuthStore((s) => s.usage);

  const processing = Boolean(queue?.processing);
  const liveJobId = processing ? (queue?.currentJobId ?? null) : null;
  const recentItems = recent?.items ?? [];
  const hasJobs = recentItems.length > 0;
  const lastJob = recentItems[0];
  const lastJobReady =
    !!lastJob && (lastJob.status === "complete" || lastJob.status === "degraded");
  const quotaExhausted =
    tier === "free" && usage.crawlsThisMonth >= usage.crawlLimit;
  const degraded = !!health && health.status !== "ok";

  return (
    <div className="flex flex-col min-h-dvh" style={{ background: PAGE_BG }}>
      <TopBar title="Dashboard" />

      <main className="flex-1 w-full">
        <div className="mx-auto w-full max-w-[1120px] px-4 sm:px-6 lg:px-8 pt-8 md:pt-12 pb-24 md:pb-32 space-y-8 md:space-y-10">
          <DegradedRibbon visible={degraded} />

          <DashboardHero
            hasJobs={hasJobs}
            processing={processing}
            lastJobReady={lastJobReady}
            quotaExhausted={quotaExhausted}
          />

          <LiveCrawlPulse jobId={liveJobId} />

          <MetricsRow health={health} />

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 md:gap-6">
            <div className="lg:col-span-2">
              <RecentAnalyses liveJobId={liveJobId} limit={5} />
            </div>
            <div className="flex flex-col gap-5 md:gap-6">
              <SystemPulse health={health} queue={queue} />
              <QuotaMeter />
            </div>
          </div>
        </div>
      </main>

      {quotaExhausted && <StickyUpgradeBar message="You've hit your free quota" />}
    </div>
  );
}
