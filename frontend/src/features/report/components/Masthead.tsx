import { motion, useReducedMotion } from "framer-motion";
import { Check, Download, Link2, RefreshCw } from "lucide-react";
import type { CrawlReport } from "../types";
import { REPORT_GRADIENTS, SECTION_IDS, EDITORIAL_EASE } from "../tokens";

interface MastheadProps {
  report: CrawlReport;
  onRunAgain?: () => void;
  onExport?: () => void;
  onShare?: () => void;
  shareCopied?: boolean;
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export function Masthead({
  report,
  onRunAgain,
  onExport,
  onShare,
  shareCopied = false,
}: MastheadProps) {
  const reduceMotion = useReducedMotion();

  return (
    <section id={SECTION_IDS.masthead} className="pt-10 pb-6 border-b border-[var(--color-border-subtle)]">
      <motion.div
        initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 6 }}
        animate={reduceMotion ? { opacity: 1 } : { opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: EDITORIAL_EASE }}
        className="flex flex-col md:flex-row md:items-end md:justify-between gap-6"
      >
        <div>
          <div
            className="text-[10.5px] font-semibold uppercase tracking-[0.22em] text-[var(--color-text-muted)]"
            style={{ fontFamily: "var(--font-label)" }}
          >
            ProdScope Intelligence Report
          </div>

          <div className="mt-3 flex items-baseline gap-3 flex-wrap">
            <h1
              className="text-[34px] md:text-[42px] font-semibold text-[var(--color-text-primary)] leading-[1.05]"
              style={{ fontFamily: "var(--font-heading)", letterSpacing: "-0.02em" }}
            >
              {report.appName || report.packageName || "Untitled build"}
            </h1>
            <span
              className="text-[13px] text-[var(--color-text-muted)]"
              style={{ fontFamily: "var(--font-mono)" }}
            >
              {report.packageName}
            </span>
          </div>

          <dl className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-[13px] text-[var(--color-text-secondary)]">
            <MetaPair label="Completed" value={formatDate(report.completedAt)} />
            <MetaPair
              label="Status"
              value={report.status}
              valueStyle={{ textTransform: "capitalize" }}
            />
            <MetaPair
              label="Quality"
              value={report.crawlQuality}
              valueStyle={{ textTransform: "capitalize" }}
            />
            <MetaPair
              label="Report ID"
              value={report.jobId.slice(0, 12)}
              mono
            />
          </dl>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {onShare && (
            <button
              type="button"
              onClick={onShare}
              aria-live="polite"
              className="inline-flex items-center gap-2 px-3.5 py-2 rounded-full text-[13px] font-medium text-[var(--color-text-secondary)] bg-white border border-[var(--color-border-default)] hover:border-[var(--color-border-hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent-ring)] transition-colors"
            >
              {shareCopied ? (
                <>
                  <Check className="w-3.5 h-3.5 text-[var(--color-success,#0E8A4F)]" />
                  Link copied
                </>
              ) : (
                <>
                  <Link2 className="w-3.5 h-3.5" />
                  Copy link
                </>
              )}
            </button>
          )}
          {onExport && (
            <button
              type="button"
              onClick={onExport}
              className="inline-flex items-center gap-2 px-3.5 py-2 rounded-full text-[13px] font-medium text-[var(--color-text-secondary)] bg-white border border-[var(--color-border-default)] hover:border-[var(--color-border-hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent-ring)] transition-colors"
            >
              <Download className="w-3.5 h-3.5" />
              Download HTML
            </button>
          )}
          {onRunAgain && (
            <button
              type="button"
              onClick={onRunAgain}
              className="inline-flex items-center gap-2 px-3.5 py-2 rounded-full text-[13px] font-medium text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent-ring)] transition-opacity hover:opacity-95"
              style={{ background: REPORT_GRADIENTS.hero }}
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Run again
            </button>
          )}
        </div>
      </motion.div>
    </section>
  );
}

function MetaPair({
  label,
  value,
  mono,
  valueStyle,
}: {
  label: string;
  value: string;
  mono?: boolean;
  valueStyle?: React.CSSProperties;
}) {
  return (
    <div className="flex flex-col">
      <dt
        className="text-[10px] font-medium uppercase tracking-[0.18em] text-[var(--color-text-muted)]"
        style={{ fontFamily: "var(--font-label)" }}
      >
        {label}
      </dt>
      <dd
        className="text-[13.5px] text-[var(--color-text-primary)]"
        style={{ fontFamily: mono ? "var(--font-mono)" : undefined, ...valueStyle }}
      >
        {value}
      </dd>
    </div>
  );
}
