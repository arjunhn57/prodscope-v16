import { useMemo } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Wrench, Shield, Accessibility, Gauge, Compass } from "lucide-react";
import type { CrawlReport, Recommendation } from "../types";
import { REPORT_SURFACES, SECTION_IDS, SEVERITY_COLOR, EDITORIAL_EASE } from "../tokens";
import { buildRecommendations } from "../useReportData";
import { GatedContent } from "../../../components/shared/GatedContent";

interface RecommendationsProps {
  report: CrawlReport;
}

const AREA_META: Record<
  Recommendation["area"],
  { label: string; icon: typeof Wrench }
> = {
  ux: { label: "UX", icon: Wrench },
  accessibility: { label: "Accessibility", icon: Accessibility },
  stability: { label: "Stability", icon: Shield },
  navigation: { label: "Navigation", icon: Compass },
  performance: { label: "Performance", icon: Gauge },
};

const EFFORT_META: Record<
  Recommendation["effort"],
  { label: string; sub: string }
> = {
  XS: { label: "XS", sub: "<1h" },
  S: { label: "S", sub: "~half day" },
  M: { label: "M", sub: "1–2 days" },
  L: { label: "L", sub: "sprint" },
};

function groupByArea(recs: Recommendation[]): Map<Recommendation["area"], Recommendation[]> {
  const out = new Map<Recommendation["area"], Recommendation[]>();
  for (const r of recs) {
    const bucket = out.get(r.area) ?? [];
    bucket.push(r);
    out.set(r.area, bucket);
  }
  return out;
}

function RecommendationsInner({ report }: { report: CrawlReport }) {
  const reduceMotion = useReducedMotion();
  const recs = useMemo(() => buildRecommendations(report), [report]);
  const grouped = useMemo(() => groupByArea(recs), [recs]);

  if (recs.length === 0) {
    return (
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
          No recommendations surfaced — the build is in strong shape.
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      {Array.from(grouped.entries()).map(([area, list], groupIdx) => {
        const meta = AREA_META[area] ?? { label: area, icon: Wrench };
        const AreaIcon = meta.icon;

        return (
          <motion.div
            key={area}
            initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 8 }}
            whileInView={reduceMotion ? { opacity: 1 } : { opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{
              duration: 0.4,
              delay: reduceMotion ? 0 : 0.08 + groupIdx * 0.05,
              ease: EDITORIAL_EASE,
            }}
          >
            <div className="flex items-center gap-2 mb-4">
              <span
                className="w-7 h-7 rounded-full flex items-center justify-center"
                style={{
                  background: "rgba(108,71,255,0.08)",
                  border: "1px solid rgba(108,71,255,0.22)",
                }}
              >
                <AreaIcon className="w-3.5 h-3.5 text-[var(--color-report-accent)]" />
              </span>
              <span
                className="text-[10.5px] font-semibold uppercase tracking-[0.22em] text-[var(--color-text-secondary)]"
                style={{ fontFamily: "var(--font-label)" }}
              >
                {meta.label}
              </span>
              <span
                className="text-[10.5px] tabular-nums text-[var(--color-text-muted)] px-2 py-0.5 rounded-full"
                style={{
                  background: "#F1F5F9",
                  border: "1px solid #E2E8F0",
                }}
              >
                {list.length}
              </span>
            </div>

            <div className="grid md:grid-cols-2 gap-3">
              {list.map((rec, i) => {
                const palette = SEVERITY_COLOR[rec.severity];
                return (
                  <motion.article
                    key={rec.id}
                    initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 8 }}
                    whileInView={reduceMotion ? { opacity: 1 } : { opacity: 1, y: 0 }}
                    viewport={{ once: true }}
                    transition={{
                      duration: 0.35,
                      delay: reduceMotion ? 0 : 0.05 + i * 0.05,
                      ease: EDITORIAL_EASE,
                    }}
                    className="p-5 rounded-[18px] bg-white flex flex-col gap-3"
                    style={{
                      border: REPORT_SURFACES.borderDefault,
                      boxShadow: REPORT_SURFACES.shadowSoft,
                    }}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-2 min-w-0">
                        <span
                          className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10.5px] font-semibold uppercase tracking-[0.18em]"
                          style={{
                            background: palette.bg,
                            color: palette.fg,
                            border: `1px solid ${palette.ring}`,
                            fontFamily: "var(--font-label)",
                          }}
                        >
                          <span
                            className="w-1.5 h-1.5 rounded-full"
                            style={{ background: palette.dot }}
                          />
                          {rec.severity}
                        </span>
                      </div>
                      <EffortBadge effort={rec.effort} />
                    </div>

                    <h3
                      className="text-[17px] font-semibold text-[var(--color-text-primary)] leading-snug"
                      style={{ fontFamily: "var(--font-heading)", letterSpacing: "-0.01em" }}
                    >
                      {rec.title}
                    </h3>

                    <p
                      className="text-[13.5px] leading-[1.6] text-[var(--color-text-secondary)]"
                      style={{ fontFamily: "var(--font-sans)" }}
                    >
                      {rec.description}
                    </p>

                    {rec.linkedFindingIds && rec.linkedFindingIds.length > 0 && (
                      <div
                        className="text-[11px] text-[var(--color-text-muted)] tabular-nums"
                        style={{ fontFamily: "var(--font-mono)" }}
                      >
                        Linked findings: {rec.linkedFindingIds.length}
                      </div>
                    )}
                  </motion.article>
                );
              })}
            </div>
          </motion.div>
        );
      })}
    </div>
  );
}

function EffortBadge({ effort }: { effort: Recommendation["effort"] }) {
  const meta = EFFORT_META[effort];
  return (
    <span
      className="inline-flex items-center gap-2 text-[10.5px] font-semibold px-2 py-1 rounded-full"
      style={{
        background: "#F8FAFC",
        border: "1px solid #E2E8F0",
        color: "var(--color-text-secondary)",
        fontFamily: "var(--font-label)",
      }}
    >
      <span className="tabular-nums">Effort · {meta.label}</span>
      <span className="text-[10px] text-[var(--color-text-muted)]">{meta.sub}</span>
    </span>
  );
}

export function Recommendations({ report }: RecommendationsProps) {
  return (
    <section
      id={SECTION_IDS.recommendations}
      className="py-12 md:py-16 border-b border-[var(--color-border-subtle)]"
    >
      <div className="flex items-end justify-between gap-4 mb-6">
        <div>
          <div
            className="text-[10.5px] font-semibold uppercase tracking-[0.22em] text-[var(--color-text-muted)]"
            style={{ fontFamily: "var(--font-label)" }}
          >
            Recommendations
          </div>
          <h2
            className="mt-2 text-[28px] md:text-[34px] font-semibold text-[var(--color-text-primary)] leading-tight"
            style={{ fontFamily: "var(--font-heading)", letterSpacing: "-0.02em" }}
          >
            Prioritized fixes, ranked by impact and effort.
          </h2>
        </div>
      </div>

      <GatedContent
        feature="recommendations"
        label="Recommendations are an Enterprise feature"
      >
        <RecommendationsInner report={report} />
      </GatedContent>
    </section>
  );
}
