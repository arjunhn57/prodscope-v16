import { motion, useReducedMotion } from "framer-motion";
import type { CrawlReport, ScoreBreakdown } from "../types";
import { SECTION_IDS, EDITORIAL_EASE } from "../tokens";
import { buildExecutiveSummary } from "../useReportData";

interface ExecutiveSummaryProps {
  report: CrawlReport;
  score: ScoreBreakdown;
}

const FINDINGS_ANCHOR = `#${SECTION_IDS.findings}`;
const ATLAS_ANCHOR = `#${SECTION_IDS.atlas}`;
const RECS_ANCHOR = `#${SECTION_IDS.recommendations}`;

function decorateSummary(text: string): React.ReactNode[] {
  const tokens: Array<{ match: RegExp; href: string }> = [
    { match: /\bfindings?\b/i, href: FINDINGS_ANCHOR },
    { match: /\b(screen atlas|screens)\b/i, href: ATLAS_ANCHOR },
    { match: /\b(recommended fixes|recommendations)\b/i, href: RECS_ANCHOR },
  ];

  const out: React.ReactNode[] = [];
  let remaining = text;
  let keySeed = 0;

  while (remaining.length > 0) {
    let nearest: { index: number; length: number; href: string } | null = null;

    for (const token of tokens) {
      const m = token.match.exec(remaining);
      if (m && (nearest === null || m.index < nearest.index)) {
        nearest = { index: m.index, length: m[0].length, href: token.href };
      }
    }

    if (!nearest) {
      out.push(remaining);
      break;
    }

    if (nearest.index > 0) out.push(remaining.slice(0, nearest.index));
    const label = remaining.slice(nearest.index, nearest.index + nearest.length);
    out.push(
      <a
        key={`sum-link-${keySeed++}`}
        href={nearest.href}
        className="text-[var(--color-accent)] underline decoration-[rgba(108,71,255,0.28)] decoration-1 underline-offset-[3px] hover:decoration-[rgba(108,71,255,0.65)] transition-colors"
      >
        {label}
      </a>
    );

    remaining = remaining.slice(nearest.index + nearest.length);
    tokens.splice(
      tokens.findIndex((t) => t.href === nearest!.href),
      1
    );
  }

  return out;
}

export function ExecutiveSummary({ report, score }: ExecutiveSummaryProps) {
  const reduceMotion = useReducedMotion();
  const text = buildExecutiveSummary(report, score);
  const decorated = decorateSummary(text);

  return (
    <section
      id={SECTION_IDS.summary}
      className="py-12 md:py-16 border-b border-[var(--color-border-subtle)]"
    >
      <motion.div
        initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 10 }}
        whileInView={reduceMotion ? { opacity: 1 } : { opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-60px" }}
        transition={{ duration: 0.5, ease: EDITORIAL_EASE }}
      >
        <div
          className="text-[10.5px] font-semibold uppercase tracking-[0.22em] text-[var(--color-text-muted)]"
          style={{ fontFamily: "var(--font-label)" }}
        >
          Executive Summary
        </div>

        <p
          className="mt-5 max-w-[68ch] text-[17px] md:text-[18px] leading-[1.65] text-[var(--color-text-secondary)]"
          style={{ fontFamily: "var(--font-sans)" }}
        >
          {decorated}
        </p>
      </motion.div>
    </section>
  );
}
