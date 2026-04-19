import { useMemo, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { ChevronRight, AlertTriangle, Zap, Accessibility, Gauge } from "lucide-react";
import type { CrawlReport, Finding, Severity } from "../types";
import {
  REPORT_SURFACES,
  SECTION_IDS,
  SEVERITY_COLOR,
  SECTION_IDS as IDS,
  FINDING_TYPE_EXPLAINER,
  EDITORIAL_EASE,
} from "../tokens";
import {
  sortedFindings,
  buildReproductionTrail,
  findingTypeLabel,
} from "../useReportData";
import { CountTease } from "../../../components/shared/CountTease";
import { useAuthStore, canAccessFeature } from "../../../stores/auth";
import { ScreenLightbox, type LightboxScreen } from "./ScreenLightbox";
import { Picture } from "@/components/ui/Picture";

interface CriticalFindingsProps {
  report: CrawlReport;
}

const SEVERITY_LABEL: Record<Severity, string> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
};

function iconFor(type: string) {
  switch (type) {
    case "crash":
      return AlertTriangle;
    case "anr":
      return Zap;
    case "missing_content_description":
    case "small_tap_target":
      return Accessibility;
    case "slow_transition":
      return Gauge;
    default:
      return AlertTriangle;
  }
}

function headlineFor(finding: Finding): string {
  switch (finding.type) {
    case "crash":
      return `Crash on ${finding.element ?? "primary flow"}`;
    case "anr":
      return `ANR detected at ${finding.element ?? "main thread"}`;
    case "missing_content_description":
      return "Screen-reader labels missing on interactive elements";
    case "small_tap_target":
      return "Tap targets below the 44 × 44 dp minimum";
    case "slow_transition":
      return `Slow transition on ${finding.element ?? "transition"}`;
    default:
      return findingTypeLabel(String(finding.type));
  }
}

export function CriticalFindings({ report }: CriticalFindingsProps) {
  const reduceMotion = useReducedMotion();
  const tier = useAuthStore((s) => s.tier);
  const allowAll = canAccessFeature(tier, "full_findings");

  const all = useMemo(() => sortedFindings(report), [report]);
  const visible = allowAll ? all : all.slice(0, 3);

  const lightboxScreens = useMemo<LightboxScreen[]>(
    () =>
      all.map((f) => {
        const trail = buildReproductionTrail(f, report);
        return {
          path: trail.screenshotPath,
          label: headlineFor(f),
          caption: `${SEVERITY_LABEL[f.severity]} · Step ${f.step}`,
          step: f.step,
        };
      }),
    [all, report]
  );

  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  return (
    <section
      id={IDS.findings ?? SECTION_IDS.findings}
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
              className="text-[10.5px] font-semibold uppercase tracking-[0.22em] text-[var(--color-text-muted)]"
              style={{ fontFamily: "var(--font-label)" }}
            >
              Critical Findings
            </div>
            <h2
              className="mt-2 text-[28px] md:text-[34px] font-semibold text-[var(--color-text-primary)] leading-tight"
              style={{ fontFamily: "var(--font-heading)", letterSpacing: "-0.02em" }}
            >
              {all.length === 0
                ? "No issues surfaced."
                : `${all.length} issue${all.length === 1 ? "" : "s"} detected`}
            </h2>
          </div>
        </div>

        {all.length === 0 ? (
          <div
            className="px-6 py-10 rounded-[20px] text-center"
            style={{
              background: "#F0FDFA",
              border: "1px solid rgba(20,184,166,0.2)",
            }}
          >
            <div
              className="text-[14px] text-[#0F766E]"
              style={{ fontFamily: "var(--font-sans)" }}
            >
              Clean run — ProdScope completed the full analysis with no stability,
              accessibility, or performance violations triggered.
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {visible.map((finding, i) => {
              const palette = SEVERITY_COLOR[finding.severity];
              const Icon = iconFor(String(finding.type));
              const trail = buildReproductionTrail(finding, report);
              const globalIdx = all.indexOf(finding);

              return (
                <motion.article
                  key={finding.id}
                  initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 8 }}
                  whileInView={reduceMotion ? { opacity: 1 } : { opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{
                    duration: 0.4,
                    delay: reduceMotion ? 0 : 0.08 + i * 0.06,
                    ease: EDITORIAL_EASE,
                  }}
                  className="relative grid grid-cols-1 md:grid-cols-[200px_1fr] gap-5 p-5 md:p-6 rounded-[20px] bg-white"
                  style={{
                    border: REPORT_SURFACES.borderDefault,
                    boxShadow: REPORT_SURFACES.shadowSoft,
                  }}
                >
                  <span
                    aria-hidden
                    className="absolute left-0 top-6 bottom-6 w-[3px] rounded-r"
                    style={{ background: palette.dot }}
                  />

                  <button
                    type="button"
                    onClick={() => setLightboxIndex(globalIdx)}
                    className="group relative w-full aspect-[9/16] max-w-[200px] rounded-xl overflow-hidden focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent-ring)]"
                    style={{
                      background: "#F1F5F9",
                      border: "1px solid #E2E8F0",
                    }}
                    aria-label={`Open screenshot for ${headlineFor(finding)}`}
                  >
                    {trail.screenshotPath ? (
                      <Picture
                        src={trail.screenshotPath}
                        alt={`Step ${finding.step}: ${headlineFor(finding)}`}
                        width={220}
                        height={476}
                        className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-[11px] text-[var(--color-text-muted)]">
                        No capture
                      </div>
                    )}
                    <span
                      className="absolute top-2 left-2 text-[9.5px] font-semibold uppercase tracking-[0.18em] px-2 py-1 rounded-full"
                      style={{
                        fontFamily: "var(--font-label)",
                        background: palette.bg,
                        color: palette.fg,
                        border: `1px solid ${palette.ring}`,
                      }}
                    >
                      {SEVERITY_LABEL[finding.severity]}
                    </span>
                  </button>

                  <div className="flex flex-col gap-3 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span
                        className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-[11px] font-medium"
                        style={{
                          background: palette.bg,
                          color: palette.fg,
                          border: `1px solid ${palette.ring}`,
                        }}
                      >
                        <Icon className="w-3 h-3" />
                        {findingTypeLabel(String(finding.type))}
                      </span>
                      <span
                        className="text-[11px] text-[var(--color-text-muted)] tabular-nums"
                        style={{ fontFamily: "var(--font-mono)" }}
                      >
                        step {finding.step}
                      </span>
                    </div>

                    <h3
                      className="text-[20px] md:text-[22px] font-semibold text-[var(--color-text-primary)] leading-snug"
                      style={{ fontFamily: "var(--font-heading)", letterSpacing: "-0.01em" }}
                    >
                      {headlineFor(finding)}
                    </h3>

                    {trail.breadcrumbs.length > 0 && (
                      <nav
                        aria-label="Reproduction steps"
                        className="flex items-center gap-1 flex-wrap text-[12px] text-[var(--color-text-muted)]"
                      >
                        {trail.breadcrumbs.map((b, idx) => (
                          <span key={`${b.step}-${idx}`} className="inline-flex items-center gap-1">
                            <span
                              className="px-2 py-0.5 rounded-full"
                              style={{
                                background: "#F8FAFC",
                                border: "1px solid #E2E8F0",
                                color: "var(--color-text-secondary)",
                              }}
                            >
                              {b.label}
                            </span>
                            {idx < trail.breadcrumbs.length - 1 && (
                              <ChevronRight className="w-3 h-3 opacity-50" />
                            )}
                          </span>
                        ))}
                      </nav>
                    )}

                    <p
                      className="text-[14px] leading-[1.6] text-[var(--color-text-secondary)]"
                      style={{ fontFamily: "var(--font-sans)" }}
                    >
                      {finding.detail}
                    </p>

                    <div
                      className="mt-1 text-[12.5px] leading-[1.55] pl-3 border-l-2 text-[var(--color-text-muted)]"
                      style={{ borderColor: palette.ring }}
                    >
                      <span
                        className="font-semibold text-[var(--color-text-secondary)]"
                        style={{ fontFamily: "var(--font-label)" }}
                      >
                        Why this matters —
                      </span>{" "}
                      {FINDING_TYPE_EXPLAINER[String(finding.type)] ??
                        "This finding reduces the quality signal of the release."}
                    </div>
                  </div>
                </motion.article>
              );
            })}

            {!allowAll && all.length > 3 && (
              <CountTease
                visibleCount={3}
                totalCount={all.length}
                itemLabel="findings"
                skeletonCount={Math.min(3, all.length - 3)}
              />
            )}
          </div>
        )}
      </motion.div>

      <ScreenLightbox
        open={lightboxIndex !== null}
        screens={lightboxScreens}
        index={lightboxIndex ?? 0}
        onClose={() => setLightboxIndex(null)}
        onNavigate={(next) => setLightboxIndex(next)}
      />
    </section>
  );
}
