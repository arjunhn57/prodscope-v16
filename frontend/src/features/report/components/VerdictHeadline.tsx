import { motion, useReducedMotion } from "framer-motion";
import type { CrawlReport, ScoreBreakdown } from "../types";
import { REPORT_GRADIENTS, SECTION_IDS, EDITORIAL_EASE } from "../tokens";
import { buildVerdictSentence } from "../useReportData";

interface VerdictHeadlineProps {
  report: CrawlReport;
  score: ScoreBreakdown;
}

export function VerdictHeadline({ report, score }: VerdictHeadlineProps) {
  const reduceMotion = useReducedMotion();
  const verdict = buildVerdictSentence(report, score);

  const highlightIdx = verdict.text.indexOf(verdict.highlight);
  const before = highlightIdx >= 0 ? verdict.text.slice(0, highlightIdx) : verdict.text;
  const highlight = highlightIdx >= 0 ? verdict.highlight : "";
  const after =
    highlightIdx >= 0
      ? verdict.text.slice(highlightIdx + verdict.highlight.length)
      : "";

  return (
    <section
      id={SECTION_IDS.verdict}
      className="py-16 md:py-24 border-b border-[var(--color-border-subtle)]"
    >
      <motion.div
        initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 12 }}
        whileInView={reduceMotion ? { opacity: 1 } : { opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-80px" }}
        transition={{ duration: 0.55, ease: EDITORIAL_EASE }}
      >
        <div
          className="text-[10.5px] font-semibold uppercase tracking-[0.22em] text-[var(--color-report-accent)]"
          style={{ fontFamily: "var(--font-label)" }}
        >
          Verdict
        </div>
        <h2
          className="mt-5 text-[40px] leading-[1.08] md:text-[64px] md:leading-[1.05] font-semibold text-[var(--color-text-primary)] max-w-[22ch]"
          style={{
            fontFamily: "var(--font-heading)",
            letterSpacing: "-0.03em",
          }}
        >
          {before}
          {highlight && (
            <span
              style={{
                background: REPORT_GRADIENTS.hero,
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
                backgroundClip: "text",
              }}
            >
              {highlight}
            </span>
          )}
          {after}
        </h2>
      </motion.div>
    </section>
  );
}
