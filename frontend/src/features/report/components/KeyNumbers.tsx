import { motion, useReducedMotion } from "framer-motion";
import type { CrawlReport, ScoreBreakdown } from "../types";
import { REPORT_GRADIENTS, REPORT_SURFACES, SECTION_IDS, EDITORIAL_EASE } from "../tokens";
import { humanizeDuration } from "../useReportData";

interface KeyNumbersProps {
  report: CrawlReport;
  score: ScoreBreakdown;
}

interface Tile {
  label: string;
  value: string;
  sub?: string;
  accent?: boolean;
}

function buildTiles(report: CrawlReport, score: ScoreBreakdown): Tile[] {
  const uniqueScreens =
    report.v2Coverage.uniqueScreens || report.screens.length || 0;
  const steps = report.stats.totalSteps || report.screens.length || 0;
  const findings = report.oracleFindings.length;
  const criticalCount = report.oracleFindings.filter(
    (f) => f.severity === "critical"
  ).length;
  const cost = report.v2Coverage.costUSD ?? 0;

  return [
    {
      label: "Unique screens",
      value: String(uniqueScreens),
      sub: `${report.screens.length} captured`,
    },
    {
      label: "Steps taken",
      value: String(steps),
      sub:
        report.v2Coverage.uniquePerStep > 0
          ? `${Math.round(report.v2Coverage.uniquePerStep * 100)}% novel`
          : undefined,
    },
    {
      label: "Coverage",
      value: `${score.coverage}%`,
      sub: "weighted avg",
    },
    {
      label: "Analysis time",
      value: humanizeDuration(report),
      sub:
        report.v2Coverage.uniquePerMinute > 0
          ? `${report.v2Coverage.uniquePerMinute.toFixed(1)}/min`
          : undefined,
    },
    {
      label: "Findings",
      value: String(findings),
      sub: criticalCount > 0 ? `${criticalCount} critical` : "no critical",
      accent: criticalCount > 0,
    },
    {
      label: "Cost",
      value: `$${cost.toFixed(2)}`,
      sub:
        report.v2Coverage.cacheHitRate > 0
          ? `${Math.round(report.v2Coverage.cacheHitRate * 100)}% cache hit`
          : undefined,
    },
  ];
}

export function KeyNumbers({ report, score }: KeyNumbersProps) {
  const reduceMotion = useReducedMotion();
  const tiles = buildTiles(report, score);

  return (
    <section
      id={SECTION_IDS.keyNumbers}
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
          Key Numbers
        </div>

        <div className="mt-5 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          {tiles.map((tile, i) => (
            <motion.div
              key={tile.label}
              initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 8 }}
              whileInView={reduceMotion ? { opacity: 1 } : { opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{
                duration: 0.4,
                delay: reduceMotion ? 0 : 0.1 + i * 0.06,
                ease: EDITORIAL_EASE,
              }}
              className="px-4 py-5 rounded-2xl"
              style={{
                background: REPORT_GRADIENTS.auroraTile,
                border: tile.accent
                  ? "1px solid rgba(239,68,68,0.22)"
                  : "1px solid rgba(108,71,255,0.14)",
                boxShadow: REPORT_SURFACES.shadowSoft,
              }}
            >
              <div
                className="text-[10.5px] font-semibold uppercase tracking-[0.2em] text-[var(--color-text-muted)]"
                style={{ fontFamily: "var(--font-label)" }}
              >
                {tile.label}
              </div>
              <div
                className="mt-2 text-[32px] md:text-[38px] font-semibold text-[var(--color-text-primary)] leading-none tabular-nums"
                style={{
                  fontFamily: "var(--font-heading)",
                  letterSpacing: "-0.03em",
                  ...(tile.accent
                    ? {
                        background: REPORT_GRADIENTS.hero,
                        WebkitBackgroundClip: "text",
                        WebkitTextFillColor: "transparent",
                        backgroundClip: "text",
                      }
                    : {}),
                }}
              >
                {tile.value}
              </div>
              {tile.sub && (
                <div
                  className="mt-2 text-[11.5px] text-[var(--color-text-muted)]"
                  style={{ fontFamily: "var(--font-sans)" }}
                >
                  {tile.sub}
                </div>
              )}
            </motion.div>
          ))}
        </div>
      </motion.div>
    </section>
  );
}
