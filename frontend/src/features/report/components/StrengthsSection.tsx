import { useMemo, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Check, MessageCircleQuestion } from "lucide-react";
import type { CrawlReport, V2DiligenceFlag } from "../types";
import {
  REPORT_SURFACES,
  SECTION_IDS,
  STRENGTH_PALETTE,
  EDITORIAL_EASE,
} from "../tokens";
import { strengthFlags } from "../useReportData";
import { Picture } from "@/components/ui/Picture";
import { AnnotatedScreenshot } from "./AnnotatedScreenshot";

interface StrengthsSectionProps {
  report: CrawlReport;
}

/**
 * Find the screenshot path for a screen_<step> evidence id.
 * The screens array has step + path; map the cited id back to a path.
 */
function screenshotForEvidence(
  report: CrawlReport,
  evidenceId: string
): { path: string | null; step: number | null } {
  const match = evidenceId.match(/^screen_(\d+)$/);
  if (!match) return { path: null, step: null };
  const step = Number(match[1]);
  const screen = report.screens.find((s) => s.step === step);
  return { path: screen?.path ?? null, step };
}

const CONFIDENCE_LABEL: Record<string, string> = {
  observed: "Observed",
  inferred: "Inferred",
  hypothesis: "Hypothesis",
};

export function StrengthsSection({ report }: StrengthsSectionProps) {
  const reduceMotion = useReducedMotion();
  const strengths = useMemo<V2DiligenceFlag[]>(
    () => strengthFlags(report),
    [report]
  );

  const [expanded, setExpanded] = useState<number | null>(null);

  // No strengths surfaced — show a quiet acknowledgment, NOT a celebration.
  // The V2 prompt's BALANCE RULE makes this rare; when it does happen it
  // means the trace genuinely lacked positive signal worth citing, which
  // is itself worth surfacing rather than padding with weak praise.
  if (strengths.length === 0) {
    return (
      <section
        id={SECTION_IDS.strengths}
        className="py-12 md:py-16 border-b border-[var(--color-border-subtle)]"
      >
        <motion.div
          initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 10 }}
          whileInView={reduceMotion ? { opacity: 1 } : { opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-60px" }}
          transition={{ duration: 0.5, ease: EDITORIAL_EASE }}
        >
          <div
            className="text-[10.5px] font-semibold uppercase tracking-[0.22em] text-[var(--color-text-muted)] mb-2"
            style={{ fontFamily: "var(--font-label)" }}
          >
            Strengths
          </div>
          <h2
            className="text-[28px] md:text-[34px] font-semibold text-[var(--color-text-primary)] leading-tight mb-4"
            style={{ fontFamily: "var(--font-heading)", letterSpacing: "-0.02em" }}
          >
            None surfaced in the explored surface
          </h2>
          <p
            className="text-[14px] leading-[1.6] text-[var(--color-text-secondary)] max-w-2xl"
            style={{ fontFamily: "var(--font-sans)" }}
          >
            ProdScope did not find a citeable product strength in the screens
            it reached. This may indicate either that the explored surface is
            primarily unfinished onboarding/auth, or that the build genuinely
            lacks polish moments worth highlighting. Worth probing on the
            founder call.
          </p>
        </motion.div>
      </section>
    );
  }

  return (
    <section
      id={SECTION_IDS.strengths}
      className="py-12 md:py-16 border-b border-[var(--color-border-subtle)]"
    >
      <motion.div
        initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 10 }}
        whileInView={reduceMotion ? { opacity: 1 } : { opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-60px" }}
        transition={{ duration: 0.5, ease: EDITORIAL_EASE }}
      >
        <div className="flex items-end justify-between gap-4 mb-6">
          <div>
            <div
              className="text-[10.5px] font-semibold uppercase tracking-[0.22em] mb-2"
              style={{
                fontFamily: "var(--font-label)",
                color: STRENGTH_PALETTE.fg,
              }}
            >
              Strengths
            </div>
            <h2
              className="text-[28px] md:text-[34px] font-semibold text-[var(--color-text-primary)] leading-tight"
              style={{ fontFamily: "var(--font-heading)", letterSpacing: "-0.02em" }}
            >
              {strengths.length} thing{strengths.length === 1 ? "" : "s"} this
              build does well
            </h2>
            <p
              className="mt-2 text-[14px] text-[var(--color-text-muted)] max-w-2xl leading-[1.6]"
              style={{ fontFamily: "var(--font-sans)" }}
            >
              Areas where the team has demonstrated intentional craft, anchored
              to specific screens.
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-3">
          {strengths.map((strength, i) => {
            const primaryEvidence = strength.evidence_screen_ids[0];
            const { path: screenshotPath, step } = primaryEvidence
              ? screenshotForEvidence(report, primaryEvidence)
              : { path: null, step: null };
            const isExpanded = expanded === i;

            return (
              <motion.article
                key={i}
                initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 8 }}
                whileInView={reduceMotion ? { opacity: 1 } : { opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{
                  duration: 0.4,
                  delay: reduceMotion ? 0 : 0.08 + i * 0.06,
                  ease: EDITORIAL_EASE,
                }}
                className="relative grid grid-cols-1 md:grid-cols-[180px_1fr] gap-5 p-5 md:p-6 rounded-[20px]"
                style={{
                  background: STRENGTH_PALETTE.bgGradient,
                  border: STRENGTH_PALETTE.border,
                  boxShadow: REPORT_SURFACES.shadowSoft,
                }}
              >
                <span
                  aria-hidden
                  className="absolute left-0 top-6 bottom-6 w-[3px] rounded-r"
                  style={{ background: STRENGTH_PALETTE.dot }}
                />

                {/* Screenshot — annotated when jobId present, plain otherwise */}
                <div
                  className="relative w-full aspect-[9/16] max-w-[180px] rounded-xl overflow-hidden"
                  style={{
                    background: "#F1F5F9",
                    border: "1px solid #E2E8F0",
                  }}
                >
                  {screenshotPath && step != null ? (
                    report.jobId ? (
                      <AnnotatedScreenshot
                        jobId={report.jobId}
                        screenId={`screen_${step}`}
                        screenshotUrl={screenshotPath}
                        alt={`Strength evidence: step ${step}`}
                        className="w-full h-full block"
                      />
                    ) : (
                      <Picture
                        src={screenshotPath}
                        alt={`Strength evidence: step ${step}`}
                        width={200}
                        height={356}
                        className="w-full h-full object-cover"
                      />
                    )
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-[11px] text-[var(--color-text-muted)]">
                      No capture
                    </div>
                  )}
                  <span
                    className="absolute top-2 left-2 inline-flex items-center gap-1 text-[9.5px] font-semibold uppercase tracking-[0.18em] px-2 py-1 rounded-full"
                    style={{
                      fontFamily: "var(--font-label)",
                      background: STRENGTH_PALETTE.bg,
                      color: STRENGTH_PALETTE.fg,
                      border: `1px solid ${STRENGTH_PALETTE.ring}`,
                    }}
                  >
                    <Check className="w-3 h-3" />
                    Strength
                  </span>
                </div>

                {/* Body */}
                <div className="flex flex-col gap-3 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span
                      className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-[11px] font-medium"
                      style={{
                        background: STRENGTH_PALETTE.bg,
                        color: STRENGTH_PALETTE.fg,
                        border: `1px solid ${STRENGTH_PALETTE.ring}`,
                      }}
                    >
                      <Check className="w-3 h-3" />
                      {CONFIDENCE_LABEL[strength.confidence] ?? strength.confidence}
                    </span>
                    {strength.evidence_screen_ids.map((id) => (
                      <span
                        key={id}
                        className="text-[11px] text-[var(--color-text-muted)] tabular-nums"
                        style={{ fontFamily: "var(--font-mono)" }}
                      >
                        {id}
                      </span>
                    ))}
                  </div>

                  <h3
                    className="text-[19px] md:text-[21px] font-semibold text-[var(--color-text-primary)] leading-snug"
                    style={{
                      fontFamily: "var(--font-heading)",
                      letterSpacing: "-0.01em",
                    }}
                  >
                    {strength.claim}
                  </h3>

                  {strength.severity_rationale && (
                    <p
                      className="text-[13.5px] leading-[1.6] text-[var(--color-text-secondary)]"
                      style={{ fontFamily: "var(--font-sans)" }}
                    >
                      {strength.severity_rationale}
                    </p>
                  )}

                  {/* Founder question — the killer feature; same pattern as
                      diligence flags but with a green accent. */}
                  <button
                    type="button"
                    onClick={() => setExpanded(isExpanded ? null : i)}
                    className="mt-1 text-left text-[12.5px] leading-[1.55] pl-3 border-l-2 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent-ring)] rounded-sm"
                    style={{ borderColor: STRENGTH_PALETTE.ring }}
                  >
                    <span
                      className="inline-flex items-center gap-1.5 font-semibold"
                      style={{
                        fontFamily: "var(--font-label)",
                        color: STRENGTH_PALETTE.fg,
                      }}
                    >
                      <MessageCircleQuestion className="w-3.5 h-3.5" />
                      Ask the founder —
                    </span>{" "}
                    <span className="text-[var(--color-text-secondary)]">
                      {strength.founder_question}
                    </span>
                  </button>
                </div>
              </motion.article>
            );
          })}
        </div>
      </motion.div>
    </section>
  );
}
