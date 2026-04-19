import { useMemo } from "react";
import { motion, useReducedMotion } from "framer-motion";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";
import type { CrawlReport } from "../types";
import { REPORT_SURFACES, SECTION_IDS, EDITORIAL_EASE } from "../tokens";
import { computeCoverageByArea } from "../useReportData";
import { GatedContent } from "../../../components/shared/GatedContent";

interface CoverageBreakdownProps {
  report: CrawlReport;
}

const BAR_COLOR_HIGH = "#6C47FF";
const BAR_COLOR_MID = "#8A6CFF";
const BAR_COLOR_LOW = "#F59E0B";
const BAR_COLOR_EMPTY = "#EF4444";

function colorFor(pct: number): string {
  if (pct >= 75) return BAR_COLOR_HIGH;
  if (pct >= 45) return BAR_COLOR_MID;
  if (pct >= 20) return BAR_COLOR_LOW;
  return BAR_COLOR_EMPTY;
}

interface TooltipProps {
  active?: boolean;
  payload?: Array<{ payload: { area: string; percentage: number } }>;
}

function CustomTooltip({ active, payload }: TooltipProps) {
  if (!active || !payload || payload.length === 0) return null;
  const row = payload[0].payload;
  return (
    <div
      className="px-3 py-2 rounded-lg text-[12px]"
      style={{
        background: "#FFFFFF",
        border: "1px solid #E2E8F0",
        boxShadow: REPORT_SURFACES.shadowSoft,
        fontFamily: "var(--font-sans)",
      }}
    >
      <div className="font-semibold text-[var(--color-text-primary)] capitalize">
        {row.area}
      </div>
      <div className="text-[var(--color-text-secondary)] tabular-nums mt-1">
        {row.percentage}% covered
      </div>
    </div>
  );
}

function BreakdownChart({ report }: { report: CrawlReport }) {
  const reduceMotion = useReducedMotion();
  const rows = useMemo(() => computeCoverageByArea(report), [report]);
  const chartData = rows.map((r) => ({
    ...r,
    area: r.area.replace(/_/g, " "),
  }));
  const uncovered = rows.filter((r) => r.percentage < 40);

  if (rows.length === 0) {
    return (
      <div
        className="px-6 py-10 rounded-[20px] text-center text-[var(--color-text-muted)] text-[13px]"
        style={{
          background: "#F8FAFC",
          border: REPORT_SURFACES.borderDefault,
        }}
      >
        No coverage data was recorded for this analysis.
      </div>
    );
  }

  const height = Math.max(260, rows.length * 44);

  return (
    <div className="grid lg:grid-cols-[1.3fr_1fr] gap-6 items-start">
      <motion.div
        initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 8 }}
        whileInView={reduceMotion ? { opacity: 1 } : { opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.4, ease: EDITORIAL_EASE }}
        className="p-5 md:p-6 rounded-[20px] bg-white"
        style={{
          border: REPORT_SURFACES.borderDefault,
          boxShadow: REPORT_SURFACES.shadowSoft,
        }}
      >
        <div
          className="text-[10.5px] font-semibold uppercase tracking-[0.22em] text-[var(--color-text-muted)] mb-3"
          style={{ fontFamily: "var(--font-label)" }}
        >
          Coverage by area
        </div>
        <div style={{ width: "100%", height }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={chartData}
              layout="vertical"
              margin={{ top: 8, right: 24, bottom: 8, left: 0 }}
              barCategoryGap={14}
            >
              <CartesianGrid
                horizontal={false}
                stroke="#E2E8F0"
                strokeDasharray="3 3"
              />
              <XAxis
                type="number"
                domain={[0, 100]}
                tick={{ fill: "#94A3B8", fontSize: 11 }}
                axisLine={{ stroke: "#E2E8F0" }}
                tickLine={false}
                unit="%"
              />
              <YAxis
                type="category"
                dataKey="area"
                width={110}
                tick={{
                  fill: "#475569",
                  fontSize: 12,
                  fontFamily: "var(--font-label)",
                }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip content={<CustomTooltip />} cursor={{ fill: "rgba(108,71,255,0.06)" }} />
              <Bar
                dataKey="percentage"
                radius={[0, 8, 8, 0]}
                isAnimationActive={!reduceMotion}
              >
                {chartData.map((row) => (
                  <Cell key={row.area} fill={colorFor(row.percentage)} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </motion.div>

      <motion.div
        initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 8 }}
        whileInView={reduceMotion ? { opacity: 1 } : { opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.4, delay: 0.08, ease: EDITORIAL_EASE }}
        className="p-5 md:p-6 rounded-[20px] bg-white"
        style={{
          border: REPORT_SURFACES.borderDefault,
          boxShadow: REPORT_SURFACES.shadowSoft,
        }}
      >
        <div
          className="text-[10.5px] font-semibold uppercase tracking-[0.22em] text-[var(--color-text-muted)] mb-3"
          style={{ fontFamily: "var(--font-label)" }}
        >
          Under-explored areas
        </div>
        {uncovered.length === 0 ? (
          <div
            className="text-[13px] text-[var(--color-text-secondary)] leading-[1.6]"
            style={{ fontFamily: "var(--font-sans)" }}
          >
            All tracked areas received meaningful traversal — no gaps flagged.
          </div>
        ) : (
          <ul className="flex flex-col gap-3">
            {uncovered.map((row) => (
              <li
                key={row.area}
                className="flex items-start justify-between gap-3"
              >
                <div className="min-w-0">
                  <div
                    className="text-[13px] font-medium text-[var(--color-text-primary)] capitalize"
                    style={{ fontFamily: "var(--font-sans)" }}
                  >
                    {row.area.replace(/_/g, " ")}
                  </div>
                  <div className="mt-1 text-[11.5px] text-[var(--color-text-muted)] leading-[1.5]">
                    {row.percentage < 20
                      ? "Likely blocked by auth, paywall, or missing entry point."
                      : row.percentage < 40
                        ? "Reached but shallowly explored. Consider deeper step budget."
                        : "Partial coverage — likely capped by step budget."}
                  </div>
                </div>
                <span
                  className="shrink-0 text-[11.5px] font-semibold tabular-nums px-2 py-0.5 rounded-full"
                  style={{
                    background: "#FEF2F2",
                    color: "#B91C1C",
                    border: "1px solid rgba(239,68,68,0.22)",
                    fontFamily: "var(--font-mono)",
                  }}
                >
                  {row.percentage}%
                </span>
              </li>
            ))}
          </ul>
        )}
      </motion.div>
    </div>
  );
}

export function CoverageBreakdown({ report }: CoverageBreakdownProps) {
  return (
    <section
      id={SECTION_IDS.coverage}
      className="py-12 md:py-16 border-b border-[var(--color-border-subtle)]"
    >
      <div className="flex items-end justify-between gap-4 mb-6">
        <div>
          <div
            className="text-[10.5px] font-semibold uppercase tracking-[0.22em] text-[var(--color-text-muted)]"
            style={{ fontFamily: "var(--font-label)" }}
          >
            Coverage Breakdown
          </div>
          <h2
            className="mt-2 text-[28px] md:text-[34px] font-semibold text-[var(--color-text-primary)] leading-tight"
            style={{ fontFamily: "var(--font-heading)", letterSpacing: "-0.02em" }}
          >
            Where the analysis went — and where it didn't.
          </h2>
        </div>
      </div>

      <GatedContent
        feature="coverage_breakdown"
        label="Coverage breakdown is an Enterprise feature"
      >
        <BreakdownChart report={report} />
      </GatedContent>
    </section>
  );
}
