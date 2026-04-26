import { motion, useReducedMotion } from "framer-motion";
import { ScrollText, Sparkles } from "lucide-react";
import type { CrawlReport } from "../types";
import { REPORT_GRADIENTS, REPORT_SURFACES, SECTION_IDS, EDITORIAL_EASE } from "../tokens";

interface DecisionTimelineProps {
  report: CrawlReport;
}

export function DecisionTimeline({ report }: DecisionTimelineProps) {
  const reduceMotion = useReducedMotion();
  const steps = report.stats?.totalSteps ?? report.screens.length ?? 0;

  return (
    <section
      id={SECTION_IDS.timeline}
      className="py-12 md:py-16 border-b border-[var(--color-border-subtle)]"
    >
      <div className="flex items-end justify-between gap-4 mb-6">
        <div>
          <div
            className="text-[10.5px] font-semibold uppercase tracking-[0.22em] text-[var(--color-text-muted)]"
            style={{ fontFamily: "var(--font-label)" }}
          >
            Decision Timeline
          </div>
          <h2
            className="mt-2 text-[28px] md:text-[34px] font-semibold text-[var(--color-text-primary)] leading-tight"
            style={{ fontFamily: "var(--font-heading)", letterSpacing: "-0.02em" }}
          >
            Per-step reasoning, replayable.
          </h2>
        </div>
      </div>

      <motion.div
        initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 10 }}
        whileInView={reduceMotion ? { opacity: 1 } : { opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-60px" }}
        transition={{ duration: 0.5, ease: EDITORIAL_EASE }}
        className="relative overflow-hidden rounded-[24px] p-10 md:p-14"
        style={{
          background: REPORT_GRADIENTS.auroraTile,
          border: REPORT_SURFACES.borderDefault,
          boxShadow: REPORT_SURFACES.shadowSoft,
        }}
      >
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.08]"
          style={{
            backgroundImage:
              "linear-gradient(90deg, rgba(108,71,255,0.6) 1px, transparent 0), linear-gradient(180deg, rgba(108,71,255,0.4) 1px, transparent 0)",
            backgroundSize: "48px 48px",
          }}
        />

        <div className="relative grid md:grid-cols-[auto_1fr] gap-6 md:gap-10 items-center">
          <div
            className="relative shrink-0 w-24 h-24 md:w-28 md:h-28 rounded-3xl flex items-center justify-center"
            style={{
              background: REPORT_GRADIENTS.hero,
              boxShadow: "0 18px 44px -20px rgba(108,71,255,0.55)",
            }}
          >
            <ScrollText className="w-10 h-10 md:w-12 md:h-12 text-white" strokeWidth={1.5} />
            <span
              aria-hidden
              className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-white shadow flex items-center justify-center"
            >
              <Sparkles className="w-2.5 h-2.5 text-[var(--color-report-accent)]" />
            </span>
          </div>

          <div className="min-w-0">
            <span
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10.5px] font-semibold uppercase tracking-[0.18em]"
              style={{
                background: "rgba(108,71,255,0.12)",
                color: "var(--color-report-accent)",
                border: "1px solid rgba(108,71,255,0.28)",
                fontFamily: "var(--font-label)",
              }}
            >
              Reasoning capture — enabling shortly
            </span>
            <h3
              className="mt-3 text-[22px] md:text-[26px] font-semibold text-[var(--color-text-primary)] leading-tight"
              style={{ fontFamily: "var(--font-heading)", letterSpacing: "-0.02em" }}
            >
              Replay every decision the agent made.
            </h3>
            <p
              className="mt-3 max-w-[64ch] text-[14.5px] leading-[1.65] text-[var(--color-text-secondary)]"
              style={{ fontFamily: "var(--font-sans)" }}
            >
              This analysis executed{" "}
              <span className="font-semibold text-[var(--color-text-primary)] tabular-nums">
                {steps}
              </span>{" "}
              step{steps === 1 ? "" : "s"}. Per-step reasoning (why each action
              was taken, the expected outcome, and the observed result) is
              streamed live during the run but not yet persisted into the
              report. We're wiring up reasoning capture so the full decision
              tape is available here in a future release.
            </p>
          </div>
        </div>
      </motion.div>
    </section>
  );
}
