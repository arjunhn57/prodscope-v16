import { useCallback, useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowLeft, Loader2 } from "lucide-react";
import { TopBar } from "../../components/layout/TopBar";
import { StickyUpgradeBar } from "../../components/shared/StickyUpgradeBar";
import { useShareLink } from "../../api/hooks";
import { useReportData, computeScore } from "./useReportData";
import { EDITORIAL_EASE } from "./tokens";
import { Masthead } from "./components/Masthead";
import { VerdictHeadline } from "./components/VerdictHeadline";
import { SignalCluster } from "./components/SignalCluster";
import { ExecutiveSummary } from "./components/ExecutiveSummary";
import { KeyNumbers } from "./components/KeyNumbers";
import { StrengthsSection } from "./components/StrengthsSection";
import { CriticalFindings } from "./components/CriticalFindings";
import { ScreenAtlas } from "./components/ScreenAtlas";
import { CoverageBreakdown } from "./components/CoverageBreakdown";
import { JourneyMap } from "./components/JourneyMap";
import { DecisionTimeline } from "./components/DecisionTimeline";
import { Recommendations } from "./components/Recommendations";
import { ReportFooter } from "./components/ReportFooter";
import { SideRailTOC } from "./components/SideRailTOC";
import { MobileTOC } from "./components/MobileTOC";

function toAbsoluteApiUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  if (/^https?:\/\//i.test(path)) return path;
  const apiUrl = import.meta.env.VITE_API_URL;
  if (apiUrl) {
    try {
      return `${new URL(apiUrl).origin}${path}`;
    } catch {
      return path;
    }
  }
  return path;
}

export function ReportPage() {
  const { jobId } = useParams<{ jobId: string }>();
  const navigate = useNavigate();
  const { report, isLoading, error, rawStatus } = useReportData(jobId);
  const shareLink = useShareLink(jobId);
  const [shareCopied, setShareCopied] = useState(false);

  const score = useMemo(() => (report ? computeScore(report) : null), [report]);

  const shareUrl = shareLink.data?.shareUrl ?? null;
  const downloadHref = useMemo(() => {
    const raw = shareLink.data?.downloadUrl;
    if (!raw) return null;
    const base = toAbsoluteApiUrl(raw);
    if (!base) return null;
    return base.includes("?") ? `${base}&download=1` : `${base}?download=1`;
  }, [shareLink.data?.downloadUrl]);

  const handleShare = useCallback(() => {
    if (!shareUrl) return;
    navigator.clipboard
      .writeText(shareUrl)
      .then(() => {
        setShareCopied(true);
        window.setTimeout(() => setShareCopied(false), 2000);
      })
      .catch(() => {
        window.prompt("Copy this link to share:", shareUrl);
      });
  }, [shareUrl]);

  const handleExport = useCallback(() => {
    if (!downloadHref) return;
    window.open(downloadHref, "_blank", "noopener,noreferrer");
  }, [downloadHref]);

  if (isLoading) {
    return <PageShell title="Report"><LoadingState /></PageShell>;
  }

  if (error || !report || !score) {
    return (
      <PageShell title="Report">
        <EmptyState
          title="Report unavailable"
          subtitle={
            error
              ? "We hit an issue retrieving this analysis. Try running it again or contact support if the problem persists."
              : `No report data found for this job${rawStatus ? ` (status: ${rawStatus})` : ""}.`
          }
          onBack={() => navigate("/dashboard")}
        />
      </PageShell>
    );
  }

  return (
    <PageShell title="Report">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.3, ease: EDITORIAL_EASE }}
        className="min-h-screen"
        style={{ background: "#FAFAFA" }}
      >
        <div className="mx-auto max-w-[1200px] px-4 md:px-8 lg:px-10 py-10 md:py-16">
          <button
            type="button"
            onClick={() => navigate("/dashboard")}
            className="inline-flex items-center gap-2 text-[12.5px] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent-ring)] rounded"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Back to dashboard
          </button>

          <div className="mt-6 grid lg:grid-cols-[180px_1fr] gap-10 xl:gap-14 items-start">
            <aside className="order-2 lg:order-1">
              <SideRailTOC />
            </aside>

            <article className="order-1 lg:order-2 min-w-0">
              <Masthead
                report={report}
                onRunAgain={() => navigate("/dashboard")}
                onShare={shareUrl ? handleShare : undefined}
                shareCopied={shareCopied}
                onExport={downloadHref ? handleExport : undefined}
              />
              <VerdictHeadline report={report} score={score} />
              <SignalCluster score={score} />
              <ExecutiveSummary report={report} score={score} />
              <KeyNumbers report={report} score={score} />
              <StrengthsSection report={report} />
              <CriticalFindings report={report} />
              <ScreenAtlas report={report} />
              <CoverageBreakdown report={report} />
              <JourneyMap report={report} />
              <DecisionTimeline report={report} />
              <Recommendations report={report} />
              <ReportFooter report={report} onRunAgain={() => navigate("/dashboard")} />
            </article>
          </div>
        </div>

        <StickyUpgradeBar message="Unlock the full intelligence report" />
        <MobileTOC />
      </motion.div>
    </PageShell>
  );
}

function PageShell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-bg-primary">
      <TopBar title={title} />
      {children}
    </div>
  );
}

function LoadingState() {
  return (
    <div className="flex flex-col items-center justify-center py-24 gap-4">
      <Loader2 className="w-5 h-5 animate-spin text-[var(--color-accent)]" />
      <div
        className="text-[13px] text-[var(--color-text-muted)]"
        style={{ fontFamily: "var(--font-sans)" }}
      >
        Assembling your report…
      </div>
    </div>
  );
}

function EmptyState({
  title,
  subtitle,
  onBack,
}: {
  title: string;
  subtitle: string;
  onBack: () => void;
}) {
  return (
    <div className="mx-auto max-w-[560px] px-4 py-24 text-center">
      <h2
        className="text-[28px] font-semibold text-[var(--color-text-primary)] leading-tight"
        style={{ fontFamily: "var(--font-heading)", letterSpacing: "-0.02em" }}
      >
        {title}
      </h2>
      <p
        className="mt-3 text-[14px] leading-[1.65] text-[var(--color-text-secondary)]"
        style={{ fontFamily: "var(--font-sans)" }}
      >
        {subtitle}
      </p>
      <button
        type="button"
        onClick={onBack}
        className="mt-6 inline-flex items-center gap-2 px-4 py-2 rounded-full text-[13px] font-medium text-white"
        style={{
          background:
            "linear-gradient(120deg, #8A6CFF 0%, #6C47FF 55%, #DB2777 100%)",
        }}
      >
        <ArrowLeft className="w-3.5 h-3.5" />
        Back to dashboard
      </button>
    </div>
  );
}
