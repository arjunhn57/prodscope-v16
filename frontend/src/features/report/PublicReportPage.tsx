import { useMemo } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { motion } from "framer-motion";
import { Loader2 } from "lucide-react";
import { useReportData, computeScore, isPublicFixtureJob } from "./useReportData";
import { EDITORIAL_EASE } from "./tokens";
import { Masthead } from "./components/Masthead";
import { VerdictHeadline } from "./components/VerdictHeadline";
import { HeroFinding } from "./components/HeroFinding";
import { SignalCluster } from "./components/SignalCluster";
import { ExecutiveSummary } from "./components/ExecutiveSummary";
import { KeyNumbers } from "./components/KeyNumbers";
import { CriticalFindings } from "./components/CriticalFindings";
import { ScreenAtlas } from "./components/ScreenAtlas";
import { CoverageBreakdown } from "./components/CoverageBreakdown";
import { JourneyMap } from "./components/JourneyMap";
import { DecisionTimeline } from "./components/DecisionTimeline";
import { Recommendations } from "./components/Recommendations";
import { ReportFooter } from "./components/ReportFooter";

export function PublicReportPage() {
  const { jobId } = useParams<{ jobId: string }>();
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token");

  const isPublicSample = isPublicFixtureJob(jobId);

  const { report, isLoading, error } = useReportData(jobId, {
    publicToken: token,
  });

  const score = useMemo(() => (report ? computeScore(report) : null), [report]);

  if (!token && !isPublicSample) {
    return (
      <PublicShell>
        <EmptyState
          title="Missing share token"
          subtitle="This link is incomplete. Ask the sender to re-share the report link."
        />
      </PublicShell>
    );
  }

  if (isLoading) {
    return (
      <PublicShell isSample={isPublicSample}>
        <LoadingState />
      </PublicShell>
    );
  }

  if (error || !report || !score) {
    return (
      <PublicShell isSample={isPublicSample}>
        <EmptyState
          title="Report unavailable"
          subtitle={
            error
              ? "This shareable link may be invalid, expired, or the report was removed."
              : "No report data found for this link."
          }
        />
      </PublicShell>
    );
  }

  return (
    <PublicShell isSample={isPublicSample}>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.3, ease: EDITORIAL_EASE }}
        className="min-h-screen"
        style={{ background: "#FAFAFA" }}
      >
        <div className="mx-auto max-w-[960px] px-4 md:px-8 lg:px-10 py-10 md:py-16">
          <article className="min-w-0">
            <Masthead report={report} />
            <VerdictHeadline report={report} score={score} />
            <HeroFinding report={report} />
            <SignalCluster score={score} />
            <ExecutiveSummary report={report} score={score} />
            <KeyNumbers report={report} score={score} />
            <CriticalFindings report={report} />
            <ScreenAtlas report={report} />
            <CoverageBreakdown report={report} />
            <JourneyMap report={report} />
            <DecisionTimeline report={report} />
            <Recommendations report={report} />
            <ReportFooter report={report} />
          </article>
        </div>
      </motion.div>
    </PublicShell>
  );
}

function PublicShell({
  children,
  isSample = false,
}: {
  children: React.ReactNode;
  isSample?: boolean;
}) {
  return (
    <div className="min-h-screen" style={{ background: "#FAFAFA" }}>
      <header className="border-b border-[var(--color-border-subtle)] bg-white">
        <div className="mx-auto max-w-[960px] px-4 md:px-8 lg:px-10 py-4 flex items-center justify-between">
          <a
            href="/"
            className="text-[15px] font-semibold text-[var(--color-text-primary)] tracking-tight focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-report-accent-ring)] rounded"
            style={{ fontFamily: "var(--font-heading)" }}
          >
            ProdScope
          </a>
          <span
            className="text-[11px] font-medium uppercase tracking-[0.18em] text-[var(--color-text-muted)]"
            style={{ fontFamily: "var(--font-label)" }}
          >
            {isSample ? "Sample report" : "Shared report"}
          </span>
        </div>
      </header>
      {children}
    </div>
  );
}

function LoadingState() {
  return (
    <div className="flex flex-col items-center justify-center py-24 gap-4">
      <Loader2 className="w-5 h-5 animate-spin text-[var(--color-report-accent)]" />
      <div
        className="text-[13px] text-[var(--color-text-muted)]"
        style={{ fontFamily: "var(--font-sans)" }}
      >
        Loading shared report…
      </div>
    </div>
  );
}

function EmptyState({
  title,
  subtitle,
}: {
  title: string;
  subtitle: string;
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
    </div>
  );
}
