import type { CrawlReport, ScoreBreakdown } from "../types";
import { buildVerdictSentenceV2 } from "../useReportData";

interface PrintCoverProps {
  report: CrawlReport;
  score: ScoreBreakdown;
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, {
      month: "long",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

/**
 * Phase C cover page — only renders in print/PDF context. The CSS
 * `@media print` rule in print.css un-hides this element and gives it a
 * full-page gradient background. On screen it stays hidden via the
 * default-display:none in print.css.
 *
 * Content rules:
 *   - ProdScope wordmark top-left
 *   - App name large
 *   - Package name + completion date
 *   - Top-line verdict (V2 first claim if available; otherwise the
 *     deterministic verdict sentence)
 *   - Report ID + privacy line at bottom
 */
export function PrintCover({ report, score }: PrintCoverProps) {
  const verdict = buildVerdictSentenceV2(report) ?? {
    text: "Diligence-grade analysis of this build, captured in a single pass.",
    highlight: null,
  };

  return (
    <div className="report-print-cover">
      <div className="cover-wordmark">ProdScope · Intelligence Report</div>

      <div className="cover-app-name">
        {report.appName || report.packageName || "Untitled build"}
      </div>

      <div className="cover-package">{report.packageName || "—"}</div>

      <div className="cover-verdict">{verdict.text}</div>

      <div className="cover-meta">
        <div>
          <div style={{ opacity: 0.6, fontSize: "8.5pt", letterSpacing: "0.2em", textTransform: "uppercase" }}>
            Completed
          </div>
          <div style={{ marginTop: 2, fontWeight: 600 }}>
            {formatDate(report.completedAt)}
          </div>
        </div>
        <div style={{ textAlign: "center" }}>
          <div style={{ opacity: 0.6, fontSize: "8.5pt", letterSpacing: "0.2em", textTransform: "uppercase" }}>
            Quality Score
          </div>
          <div style={{ marginTop: 2, fontWeight: 600 }}>
            {score.overall}/100
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ opacity: 0.6, fontSize: "8.5pt", letterSpacing: "0.2em", textTransform: "uppercase" }}>
            Report ID
          </div>
          <div
            style={{
              marginTop: 2,
              fontWeight: 600,
              fontFamily: "ui-monospace, SFMono-Regular, monospace",
            }}
          >
            {report.jobId.slice(0, 12)}
          </div>
        </div>
      </div>
    </div>
  );
}
