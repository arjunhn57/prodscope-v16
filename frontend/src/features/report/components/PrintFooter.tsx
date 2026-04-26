import type { CrawlReport } from "../types";

interface PrintFooterProps {
  report: CrawlReport;
}

/**
 * Phase C: fixed-position footer that appears on every page after the
 * cover when the report is printed/saved as PDF. Wordmark on the left,
 * report ID on the right. On screen it's hidden via print.css.
 *
 * Note: page numbers come from the user's print dialog "Headers and
 * footers" toggle — browser support for `@page @bottom-right`
 * margin-box content is too uneven across Chrome/Safari/Firefox to
 * rely on for now.
 */
export function PrintFooter({ report }: PrintFooterProps) {
  return (
    <div className="report-print-footer">
      <span style={{ fontWeight: 600, letterSpacing: "0.15em", textTransform: "uppercase" }}>
        ProdScope
      </span>
      <span
        style={{
          fontFamily: "ui-monospace, SFMono-Regular, monospace",
          opacity: 0.78,
        }}
      >
        Report {report.jobId.slice(0, 12)}
      </span>
    </div>
  );
}
