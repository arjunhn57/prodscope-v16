import { motion, useReducedMotion } from "framer-motion";
import { AlertTriangle, Sparkles, Eye } from "lucide-react";
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
        className="text-[var(--color-report-accent)] underline decoration-[rgba(108,71,255,0.28)] decoration-1 underline-offset-[3px] hover:decoration-[rgba(108,71,255,0.65)] transition-colors"
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
  const curated = report.executiveSummary;

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

        {/* Phase B6: prefer the LLM-curated 5-sentence analyst-voice
            summary when present. Falls back to the deterministic builder
            for legacy reports / when the Haiku call failed. */}
        {curated ? (
          <CuratedSummary curated={curated} />
        ) : (
          <p
            className="mt-5 max-w-[68ch] text-[17px] md:text-[18px] leading-[1.65] text-[var(--color-text-secondary)]"
            style={{ fontFamily: "var(--font-sans)" }}
          >
            {decorateSummary(buildExecutiveSummary(report, score))}
          </p>
        )}
      </motion.div>
    </section>
  );
}

interface CuratedProps {
  curated: NonNullable<CrawlReport["executiveSummary"]>;
}

function CuratedSummary({ curated }: CuratedProps) {
  return (
    <div className="mt-5 max-w-[68ch]">
      <p
        className="text-[19px] md:text-[20px] leading-[1.55] text-[var(--color-text-primary)] font-medium"
        style={{ fontFamily: "var(--font-heading)", letterSpacing: "-0.01em" }}
      >
        {curated.lead_sentence}
      </p>

      <ul className="mt-6 flex flex-col gap-3">
        <BulletRow
          icon={<AlertTriangle className="w-3.5 h-3.5" />}
          label="Top concern"
          tone="concern"
          text={curated.top_concern}
        />
        <BulletRow
          icon={<Sparkles className="w-3.5 h-3.5" />}
          label="Top strength"
          tone="strength"
          text={curated.top_strength}
        />
        <BulletRow
          icon={<Eye className="w-3.5 h-3.5" />}
          label="Coverage limitation"
          tone="neutral"
          text={curated.coverage_note}
        />
      </ul>

      <p
        className="mt-6 text-[15px] md:text-[16px] leading-[1.6] text-[var(--color-text-secondary)] italic"
        style={{ fontFamily: "var(--font-sans)" }}
      >
        {curated.closing_take}
      </p>
    </div>
  );
}

interface BulletRowProps {
  icon: React.ReactNode;
  label: string;
  tone: "concern" | "strength" | "neutral";
  text: string;
}

function BulletRow({ icon, label, tone, text }: BulletRowProps) {
  const palette =
    tone === "concern"
      ? { fg: "#9F1239", bg: "#FFF1F2", ring: "rgba(225,29,72,0.22)" }
      : tone === "strength"
        ? { fg: "#0F766E", bg: "#F0FDFA", ring: "rgba(20,184,166,0.22)" }
        : { fg: "#475569", bg: "#F8FAFC", ring: "rgba(100,116,139,0.18)" };

  return (
    <li className="flex items-start gap-3">
      <span
        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10.5px] font-semibold uppercase tracking-[0.14em] flex-shrink-0 mt-0.5"
        style={{
          fontFamily: "var(--font-label)",
          background: palette.bg,
          color: palette.fg,
          border: `1px solid ${palette.ring}`,
        }}
      >
        {icon}
        {label}
      </span>
      <span
        className="text-[15px] md:text-[15.5px] leading-[1.6] text-[var(--color-text-secondary)]"
        style={{ fontFamily: "var(--font-sans)" }}
      >
        {text}
      </span>
    </li>
  );
}
