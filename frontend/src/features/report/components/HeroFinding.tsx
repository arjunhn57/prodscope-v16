import { useMemo } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { AlertTriangle, MessageCircleQuestion } from "lucide-react";
import type { CrawlReport, Severity } from "../types";
import {
  REPORT_SURFACES,
  SECTION_IDS,
  SEVERITY_COLOR,
  EDITORIAL_EASE,
} from "../tokens";
import {
  heroFinding,
  buildReproductionTrail,
  findingTypeLabel,
} from "../useReportData";
import { Picture } from "@/components/ui/Picture";
import { AnnotatedScreenshot } from "./AnnotatedScreenshot";

interface HeroFindingProps {
  report: CrawlReport;
}

const SEVERITY_LABEL: Record<Severity, string> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
};

/**
 * Above-the-fold spotlight on the single sharpest finding. The first thing
 * a buyer sees after the verdict — a full annotated screenshot + the
 * "why this matters" paragraph + the concrete recommendation. Pulls from
 * `heroFinding(report)`; when no finding qualifies, the section
 * self-suppresses (clean run case).
 *
 * Visually distinct from the CriticalFindings list cards: bigger
 * screenshot (full aspect), more breathing room, severity-tinted halo
 * around the screenshot to anchor the visual hierarchy.
 */
export function HeroFinding({ report }: HeroFindingProps) {
  const reduceMotion = useReducedMotion();
  const finding = useMemo(() => heroFinding(report), [report]);
  const trail = useMemo(
    () => (finding ? buildReproductionTrail(finding, report) : null),
    [finding, report]
  );

  if (!finding || !trail) return null;
  const palette = SEVERITY_COLOR[finding.severity];

  return (
    <section
      id={SECTION_IDS.hero}
      className="py-12 md:py-16 border-b border-[var(--color-border-subtle)]"
    >
      <motion.div
        initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 12 }}
        whileInView={reduceMotion ? { opacity: 1 } : { opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-60px" }}
        transition={{ duration: 0.5, ease: EDITORIAL_EASE }}
      >
        <div
          className="text-[10.5px] font-semibold uppercase tracking-[0.22em] text-[var(--color-text-muted)] mb-3"
          style={{ fontFamily: "var(--font-label)" }}
        >
          Spotlight finding
        </div>

        <article
          className="grid grid-cols-1 md:grid-cols-[280px_1fr] gap-6 md:gap-10 p-6 md:p-8 rounded-[24px] bg-white"
          style={{
            border: REPORT_SURFACES.borderDefault,
            boxShadow: REPORT_SURFACES.shadowSoft,
          }}
        >
          <div
            className="relative w-full max-w-[280px] aspect-[9/19] rounded-2xl overflow-hidden mx-auto md:mx-0"
            style={{
              background: "#F1F5F9",
              border: `2px solid ${palette.ring}`,
              boxShadow: `0 0 0 6px ${palette.bg}`,
            }}
          >
            {trail.screenshotPath ? (
              report.jobId ? (
                <AnnotatedScreenshot
                  jobId={report.jobId}
                  screenId={`screen_${finding.step}`}
                  screenshotUrl={trail.screenshotPath}
                  alt={`Step ${finding.step}: ${finding.detail}`}
                  className="w-full h-full block"
                />
              ) : (
                <Picture
                  src={trail.screenshotPath}
                  alt={`Step ${finding.step}: ${finding.detail}`}
                  width={280}
                  height={591}
                  className="w-full h-full object-cover"
                />
              )
            ) : (
              <div className="w-full h-full flex items-center justify-center text-[12px] text-[var(--color-text-muted)]">
                No capture
              </div>
            )}
            <span
              className="absolute top-3 left-3 text-[10px] font-semibold uppercase tracking-[0.18em] px-2.5 py-1 rounded-full"
              style={{
                fontFamily: "var(--font-label)",
                background: palette.bg,
                color: palette.fg,
                border: `1px solid ${palette.ring}`,
              }}
            >
              {SEVERITY_LABEL[finding.severity]}
            </span>
          </div>

          <div className="flex flex-col gap-4 min-w-0 justify-center">
            <div className="flex items-center gap-2 flex-wrap">
              <span
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium"
                style={{
                  background: palette.bg,
                  color: palette.fg,
                  border: `1px solid ${palette.ring}`,
                }}
              >
                <AlertTriangle className="w-3 h-3" />
                {findingTypeLabel(String(finding.type))}
              </span>
              <span
                className="text-[11px] text-[var(--color-text-muted)] tabular-nums"
                style={{ fontFamily: "var(--font-mono)" }}
              >
                step {finding.step}
              </span>
            </div>

            <h2
              className="text-[26px] md:text-[32px] font-semibold text-[var(--color-text-primary)] leading-tight"
              style={{ fontFamily: "var(--font-heading)", letterSpacing: "-0.02em" }}
            >
              {finding.fromV2 && finding.claim
                ? finding.claim
                    .match(/^[^.!?]+[.!?]?/)?.[0]
                    .trim() || finding.detail
                : finding.detail}
            </h2>

            {finding.explanationMd && (
              <p
                className="text-[15px] leading-[1.65] text-[var(--color-text-secondary)]"
                style={{ fontFamily: "var(--font-sans)" }}
              >
                {finding.explanationMd}
              </p>
            )}

            {finding.recommendationMd && (
              <div
                className="text-[13.5px] leading-[1.6] pl-4 border-l-2"
                style={{ borderColor: palette.dot }}
              >
                <span
                  className="font-semibold"
                  style={{
                    fontFamily: "var(--font-label)",
                    color: palette.fg,
                  }}
                >
                  Recommended fix —
                </span>{" "}
                <span className="text-[var(--color-text-secondary)]">
                  {finding.recommendationMd}
                </span>
              </div>
            )}

            {finding.founderQuestion && (
              <div
                className="text-[13.5px] leading-[1.6] pl-4 border-l-2"
                style={{ borderColor: palette.dot }}
              >
                <span
                  className="inline-flex items-center gap-1.5 font-semibold"
                  style={{
                    fontFamily: "var(--font-label)",
                    color: palette.fg,
                  }}
                >
                  <MessageCircleQuestion className="w-3.5 h-3.5" />
                  Ask the founder —
                </span>{" "}
                <span className="text-[var(--color-text-secondary)]">
                  {finding.founderQuestion}
                </span>
              </div>
            )}
          </div>
        </article>
      </motion.div>
    </section>
  );
}
