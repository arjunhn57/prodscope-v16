import { useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Download, RefreshCw, Link as LinkIcon, FileText, Sheet } from "lucide-react";
import type { CrawlReport } from "../types";
import { REPORT_SURFACES, SECTION_IDS, EDITORIAL_EASE } from "../tokens";

interface ReportFooterProps {
  report: CrawlReport;
  onRunAgain?: () => void;
}

export function ReportFooter({ report, onRunAgain }: ReportFooterProps) {
  const reduceMotion = useReducedMotion();
  const [copied, setCopied] = useState(false);

  const handleExportJSON = () => {
    const blob = new Blob([JSON.stringify(report, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `prodscope-report-${report.jobId}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };

  return (
    <section id={SECTION_IDS.footer} className="py-12 md:py-16">
      <motion.div
        initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 10 }}
        whileInView={reduceMotion ? { opacity: 1 } : { opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-60px" }}
        transition={{ duration: 0.5, ease: EDITORIAL_EASE }}
        className="p-6 md:p-8 rounded-[20px] bg-white"
        style={{
          border: REPORT_SURFACES.borderDefault,
          boxShadow: REPORT_SURFACES.shadowSoft,
        }}
      >
        <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-6">
          <div>
            <div
              className="text-[10.5px] font-semibold uppercase tracking-[0.22em] text-[var(--color-text-muted)]"
              style={{ fontFamily: "var(--font-label)" }}
            >
              Export & share
            </div>
            <h2
              className="mt-2 text-[22px] md:text-[26px] font-semibold text-[var(--color-text-primary)] leading-tight"
              style={{ fontFamily: "var(--font-heading)", letterSpacing: "-0.02em" }}
            >
              Keep this report handy.
            </h2>
            <p
              className="mt-2 text-[13.5px] text-[var(--color-text-secondary)] max-w-[58ch] leading-[1.6]"
              style={{ fontFamily: "var(--font-sans)" }}
            >
              Download the raw analysis, share a link with your team, or start
              a fresh analysis on the same build.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <ActionButton onClick={handleExportJSON} icon={Download} label="Export JSON" />
            <ActionButton
              onClick={() => {}}
              icon={FileText}
              label="Export PDF"
              disabled
              chip="Soon"
            />
            <ActionButton
              onClick={() => {}}
              icon={Sheet}
              label="Export CSV"
              disabled
              chip="Soon"
            />
            <ActionButton
              onClick={handleCopyLink}
              icon={LinkIcon}
              label={copied ? "Link copied" : "Copy link"}
            />
            {onRunAgain && (
              <button
                type="button"
                onClick={onRunAgain}
                className="inline-flex items-center gap-2 px-3.5 py-2 rounded-full text-[13px] font-medium text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-report-accent-ring)] transition-opacity hover:opacity-95"
                style={{
                  background:
                    "linear-gradient(120deg, #8A6CFF 0%, #6C47FF 55%, #DB2777 100%)",
                }}
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Run again
              </button>
            )}
          </div>
        </div>

        <div className="mt-6 pt-5 border-t border-[#E2E8F0] grid grid-cols-2 md:grid-cols-4 gap-4 text-[11.5px]">
          <MetaLine label="Engine" value={report.engineVersion ?? "ProdScope"} />
          <MetaLine label="Completed" value={new Date(report.completedAt).toLocaleString()} />
          <MetaLine label="Quality" value={report.crawlQuality} mono capitalize />
          <MetaLine label="Report ID" value={report.jobId} mono />
        </div>

        <div
          className="mt-5 text-[11px] leading-[1.6] text-[var(--color-text-muted)] max-w-[72ch]"
          style={{ fontFamily: "var(--font-sans)" }}
        >
          ProdScope produces this report by exercising the build end-to-end and
          combining deterministic oracles (crash/ANR/responsiveness) with
          heuristics for accessibility and coverage. Scores are derived from
          observed behaviour; findings marked <em>critical</em> indicate
          ship-blocking defects.
        </div>
      </motion.div>
    </section>
  );
}

function ActionButton({
  onClick,
  icon: Icon,
  label,
  disabled,
  chip,
}: {
  onClick: () => void;
  icon: typeof Download;
  label: string;
  disabled?: boolean;
  chip?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`relative inline-flex items-center gap-2 px-3.5 py-2 rounded-full text-[13px] font-medium bg-white border transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-report-accent-ring)] ${
        disabled
          ? "opacity-60 cursor-not-allowed border-[#E2E8F0] text-[var(--color-text-muted)]"
          : "text-[var(--color-text-secondary)] border-[#E2E8F0] hover:border-[rgba(108,71,255,0.3)] hover:text-[var(--color-text-primary)]"
      }`}
    >
      <Icon className="w-3.5 h-3.5" />
      {label}
      {chip && (
        <span
          className="ml-1 text-[9.5px] font-semibold uppercase tracking-[0.16em] px-1.5 py-0.5 rounded-full"
          style={{
            background: "rgba(108,71,255,0.08)",
            color: "var(--color-report-accent)",
            border: "1px solid rgba(108,71,255,0.22)",
            fontFamily: "var(--font-label)",
          }}
        >
          {chip}
        </span>
      )}
    </button>
  );
}

function MetaLine({
  label,
  value,
  mono,
  capitalize,
}: {
  label: string;
  value: string;
  mono?: boolean;
  capitalize?: boolean;
}) {
  return (
    <div className="flex flex-col">
      <span
        className="text-[9.5px] font-semibold uppercase tracking-[0.18em] text-[var(--color-text-muted)]"
        style={{ fontFamily: "var(--font-label)" }}
      >
        {label}
      </span>
      <span
        className={`mt-1 text-[var(--color-text-secondary)] break-all ${
          capitalize ? "capitalize" : ""
        }`}
        style={{ fontFamily: mono ? "var(--font-mono)" : "var(--font-sans)" }}
      >
        {value}
      </span>
    </div>
  );
}
