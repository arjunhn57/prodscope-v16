import { useState } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";

const EASE: [number, number, number, number] = [0.22, 0.61, 0.36, 1];

/* ── Shared: Card Shell ───────────────────────────────────────────── */

function BentoCard({
  children,
  className = "",
  style,
  delay = 0,
}: {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
  delay?: number;
}) {
  const noMotion = useReducedMotion() ?? false;
  return (
    <motion.div
      initial={noMotion ? false : { opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-10% 0px" }}
      transition={{ duration: 0.6, delay, ease: EASE }}
      className={`relative rounded-[22px] overflow-hidden transition-shadow duration-300 ${className}`}
      whileHover={{
        boxShadow:
          "0 32px 70px -14px rgba(219, 39, 119, 0.18), 0 10px 24px -6px rgba(124, 58, 237, 0.14), inset 0 1px 0 rgba(255, 255, 255, 0.98), inset 0 -1px 0 rgba(219, 39, 119, 0.08)",
      }}
      style={{
        border: "1px solid rgba(219, 39, 119, 0.10)",
        boxShadow:
          "0 24px 60px -14px rgba(219, 39, 119, 0.12), 0 4px 14px -2px rgba(124, 58, 237, 0.10), inset 0 1px 0 rgba(255, 255, 255, 0.95), inset 0 -1px 0 rgba(219, 39, 119, 0.05)",
        backdropFilter: "blur(10px)",
        ...style,
      }}
    >
      {children}
    </motion.div>
  );
}

function CardLabel({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 text-[11px] font-semibold tracking-[0.08em] uppercase"
      style={{ color }}
    >
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: color }} />
      {children}
    </span>
  );
}

/* ── 1 · Coverage Map Card ────────────────────────────────────────── */

const SCREEN_NAMES = [
  { name: "Login", visited: true },
  { name: "Home", visited: true },
  { name: "Search", visited: true },
  { name: "Detail", visited: true },
  { name: "Profile", visited: true },
  { name: "Settings", visited: true },
  { name: "Cart", visited: true },
  { name: "Payment", visited: true },
  { name: "Onboard", visited: true },
  { name: "Reviews", visited: true },
  { name: "Wishlist", visited: false },
  { name: "Checkout", visited: false },
] as const;

function CoverageCard() {
  const visited = SCREEN_NAMES.filter((s) => s.visited).length;
  const total = SCREEN_NAMES.length;
  const pct = Math.round((visited / total) * 100);

  return (
    <BentoCard
      className="p-6 md:p-8"
      style={{ background: "linear-gradient(150deg, #FDFCFF 0%, #F5F3FF 100%)" }}
      delay={0}
    >
      <CardLabel color="#6C47FF">Coverage Map</CardLabel>
      <h3 className="text-[20px] md:text-[22px] font-bold tracking-tight text-[#0F172A] mt-2 mb-5">
        Every screen, mapped.
      </h3>

      {/* Screen pill grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-5">
        {SCREEN_NAMES.map((s) => (
          <div
            key={s.name}
            className="flex items-center gap-1.5 px-2.5 py-2 rounded-lg"
            style={{
              background: s.visited ? "#fff" : "transparent",
              border: `1.5px ${s.visited ? "solid" : "dashed"} ${s.visited ? "#DDD6FE" : "#CBD5E1"}`,
              opacity: s.visited ? 1 : 0.5,
            }}
          >
            {s.visited ? (
              <svg
                width="14"
                height="14"
                viewBox="0 0 16 16"
                fill="none"
                className="flex-shrink-0"
              >
                <circle cx="8" cy="8" r="8" fill="#6C47FF" />
                <path
                  d="M5 8l2 2 4-4"
                  stroke="#fff"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            ) : (
              <svg
                width="14"
                height="14"
                viewBox="0 0 16 16"
                fill="none"
                className="flex-shrink-0"
              >
                <circle
                  cx="8"
                  cy="8"
                  r="7"
                  stroke="#CBD5E1"
                  strokeWidth="1.5"
                  strokeDasharray="3 3"
                />
              </svg>
            )}
            <span className="text-[11px] font-semibold text-[#334155] truncate">
              {s.name}
            </span>
          </div>
        ))}
      </div>

      {/* Progress stat */}
      <div className="flex items-end justify-between mb-2">
        <div className="flex items-baseline gap-1.5">
          <span className="text-[32px] font-bold tracking-tight text-[#0F172A] leading-none">
            {pct}%
          </span>
          <span className="text-[13px] text-[#64748B]">coverage</span>
        </div>
        <span className="text-[12px] text-[#64748B]">
          {visited} of {total} screens
        </span>
      </div>
      <div className="h-2 rounded-full bg-[#E9E5FF] overflow-hidden">
        <div
          className="h-full rounded-full"
          style={{
            width: `${pct}%`,
            background: "linear-gradient(90deg, #6C47FF, #A78BFA)",
          }}
        />
      </div>

      <p className="text-[13px] text-[#64748B] leading-relaxed mt-4">
        Every reachable screen mapped automatically — no manual test scripts
        required.
      </p>
    </BentoCard>
  );
}

/* ── 2 · Findings Card ────────────────────────────────────────────── */

const FINDINGS = [
  {
    severity: "critical" as const,
    title: "Password field accepts empty submission",
    screen: "Login",
  },
  {
    severity: "critical" as const,
    title: "Missing alt text on 12 images",
    screen: "Home",
  },
  {
    severity: "critical" as const,
    title: "Crash on rotate during payment",
    screen: "Payment",
  },
  {
    severity: "warning" as const,
    title: "Slow network request on Cart (3.2 s)",
    screen: "Cart",
  },
  {
    severity: "warning" as const,
    title: "Share sheet missing on Android 13+",
    screen: "Detail",
  },
  {
    severity: "info" as const,
    title: "Footer link color contrast 3.8 : 1",
    screen: "Global",
  },
];

const SEV = {
  critical: { bg: "#FEE2E2", fg: "#991B1B", dot: "#EF4444" },
  warning: { bg: "#FEF3C7", fg: "#92400E", dot: "#F59E0B" },
  info: { bg: "#DBEAFE", fg: "#1E40AF", dot: "#3B82F6" },
} as const;

function FindingsCard() {
  return (
    <BentoCard className="p-6 md:p-8 bg-white" delay={0.1}>
      <CardLabel color="#EF4444">Findings</CardLabel>
      <h3 className="text-[20px] md:text-[22px] font-bold tracking-tight text-[#0F172A] mt-2 mb-1">
        Bugs, ranked by impact.
      </h3>

      {/* Severity summary */}
      <div className="flex items-center gap-4 mb-4 pb-4 border-b border-[#F1F5F9]">
        {(
          [
            { label: "Critical", count: 3, color: "#EF4444" },
            { label: "Warning", count: 8, color: "#F59E0B" },
            { label: "Info", count: 12, color: "#3B82F6" },
          ] as const
        ).map(({ label, count, color }) => (
          <div key={label} className="flex items-center gap-1.5">
            <span
              className="w-2 h-2 rounded-full"
              style={{ background: color }}
            />
            <span className="text-[12px] text-[#64748B]">
              <strong className="text-[#0F172A]">{count}</strong> {label}
            </span>
          </div>
        ))}
      </div>

      {/* Finding rows */}
      <div className="flex flex-col gap-2">
        {FINDINGS.map((f, i) => {
          const s = SEV[f.severity];
          return (
            <div
              key={i}
              className="flex items-center gap-3 px-3 py-2.5 rounded-lg"
              style={{ background: "#FDFCFF", borderLeft: `3px solid ${s.dot}` }}
            >
              <span
                className="flex-shrink-0 text-[10px] font-bold uppercase tracking-wide px-2 py-[3px] rounded"
                style={{ background: s.bg, color: s.fg }}
              >
                {f.severity}
              </span>
              <span className="text-[13px] font-medium text-[#0F172A] truncate flex-1">
                {f.title}
              </span>
              <span className="text-[11px] text-[#94A3B8] flex-shrink-0 font-mono hidden sm:inline">
                {f.screen}
              </span>
            </div>
          );
        })}
      </div>
    </BentoCard>
  );
}

/* ── 3 · PDF Report Card ──────────────────────────────────────────── */

function PdfCard() {
  const r = 28;
  const c = 2 * Math.PI * r;
  const pct = 0.87;

  return (
    <BentoCard className="p-6 md:p-8 bg-white" delay={0.15}>
      <CardLabel color="#10B981">PDF Reports</CardLabel>
      <h3 className="text-[20px] md:text-[22px] font-bold tracking-tight text-[#0F172A] mt-2 mb-5">
        Share it. Ship it.
      </h3>

      {/* Mini document preview */}
      <div
        className="rounded-xl overflow-hidden"
        style={{
          border: "1px solid rgba(124, 58, 237, 0.10)",
          boxShadow: "0 8px 32px -8px rgba(124, 58, 237, 0.10)",
        }}
      >
        {/* Header bar */}
        <div
          className="flex items-center justify-between px-4 py-2.5"
          style={{ background: "#6C47FF" }}
        >
          <span className="text-[12px] font-bold text-white tracking-tight">
            prodscope.
          </span>
          <span className="text-[10px] text-white/70">App Analysis Report</span>
        </div>

        {/* Body */}
        <div className="px-4 py-4 bg-white">
          {/* App info */}
          <div className="flex items-center gap-3 mb-4 pb-3 border-b border-[#F1F5F9]">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[#6C47FF] to-[#A78BFA] flex-shrink-0" />
            <div className="min-w-0">
              <span className="text-[13px] font-bold text-[#0F172A]">
                Zomato
              </span>
              <span className="text-[10px] text-[#94A3B8] font-mono ml-2">
                v17.5.2
              </span>
            </div>
          </div>

          {/* Score + stats */}
          <div className="flex items-center gap-4">
            <div
              className="relative flex-shrink-0"
              style={{ width: 64, height: 64 }}
            >
              <svg viewBox="0 0 64 64" width="64" height="64">
                <circle
                  cx="32"
                  cy="32"
                  r={r}
                  fill="none"
                  stroke="#E9E5FF"
                  strokeWidth="5"
                />
                <circle
                  cx="32"
                  cy="32"
                  r={r}
                  fill="none"
                  stroke="#6C47FF"
                  strokeWidth="5"
                  strokeLinecap="round"
                  strokeDasharray={`${c * pct} ${c}`}
                  transform="rotate(-90 32 32)"
                />
              </svg>
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-[16px] font-bold text-[#0F172A]">87</span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 flex-1 min-w-0">
              {(
                [
                  { v: "142", l: "Screens" },
                  { v: "23", l: "Findings" },
                  { v: "87%", l: "Coverage" },
                  { v: "4.2 m", l: "Run time" },
                ] as const
              ).map((s) => (
                <div key={s.l} className="truncate">
                  <span className="text-[15px] font-bold text-[#0F172A]">
                    {s.v}
                  </span>
                  <span className="text-[10px] text-[#94A3B8] ml-1">{s.l}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Top findings snippet */}
          <div className="mt-4 pt-3 border-t border-[#F1F5F9] flex flex-col gap-1">
            {["Missing alt text on 12 images", "Slow network request (3.2 s)", "Unused permission: CAMERA"].map(
              (f) => (
                <div
                  key={f}
                  className="text-[11px] text-[#64748B] pl-2.5 truncate"
                  style={{ borderLeft: "2px solid #6C47FF" }}
                >
                  {f}
                </div>
              ),
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-4 py-2 bg-[#FAFAFA] border-t border-[#F1F5F9]">
          <span className="text-[10px] text-[#94A3B8] font-mono">
            Page 1 of 6
          </span>
          <span className="text-[10px] font-semibold text-[#6C47FF]">
            Download PDF ↓
          </span>
        </div>
      </div>
    </BentoCard>
  );
}

/* ── 4 · API Access Card ──────────────────────────────────────────── */

const REQ = `POST /v1/analyze HTTP/1.1
Authorization: Bearer sk_prod_•••
Content-Type: application/json

{
  "apkUrl": "https://cdn.example.com/app.apk",
  "webhook": "https://ci.example.com/hooks"
}`;

const RES = `{
  "reportId": "rpt_4f9c8a2e",
  "status": "complete",
  "score": 87,
  "screens": 142,
  "findings": 23,
  "reportUrl": "https://prodscope.io/r/4f9c8a2e"
}`;

function TerminalBlockCompact({
  title,
  badge,
  code,
}: {
  title: string;
  badge?: string;
  code: string;
}) {
  return (
    <div
      className="rounded-lg overflow-hidden"
      style={{
        border: "1px solid rgba(15, 23, 42, 0.08)",
        boxShadow: "0 4px 14px -6px rgba(15, 23, 42, 0.18)",
      }}
    >
      <div
        className="flex items-center gap-2 px-3 py-2"
        style={{
          background: "#0F172A",
          borderBottom: "1px solid rgba(255, 255, 255, 0.06)",
        }}
      >
        <span className="w-[7px] h-[7px] rounded-full bg-[#FF5F57]" />
        <span className="w-[7px] h-[7px] rounded-full bg-[#FFBD2E]" />
        <span className="w-[7px] h-[7px] rounded-full bg-[#28CA42]" />
        <span className="text-[10px] font-mono text-[#94A3B8] ml-1 tracking-[0.04em]">
          {title}
        </span>
        {badge && (
          <span className="ml-auto text-[10px] font-mono px-2 py-0.5 rounded bg-[#065F46] text-[#6EE7B7]">
            {badge}
          </span>
        )}
      </div>
      <div
        className="relative"
        style={{
          background: "#0F172A",
          maxHeight: "200px",
          overflow: "hidden",
          WebkitMaskImage:
            "linear-gradient(to bottom, black 75%, transparent 100%)",
          maskImage:
            "linear-gradient(to bottom, black 75%, transparent 100%)",
        }}
      >
        <pre className="px-3 py-2.5 text-[10px] sm:text-[11px] font-mono leading-[1.7] text-[#E2E8F0] whitespace-pre-wrap break-all sm:break-normal sm:whitespace-pre sm:overflow-x-auto m-0">
          {code}
        </pre>
      </div>
    </div>
  );
}

function ApiCard() {
  const [tab, setTab] = useState<"req" | "res">("req");
  return (
    <BentoCard
      className="p-6 md:p-8"
      style={{ background: "linear-gradient(150deg, #FDFCFF 0%, #F5F3FF 100%)" }}
      delay={0.2}
    >
      <CardLabel color="#6C47FF">API Access</CardLabel>
      <h3 className="text-[20px] md:text-[22px] font-bold tracking-tight text-[#0F172A] mt-2 mb-5">
        Plug into any pipeline.
      </h3>

      <div
        className="inline-flex items-center gap-1 p-1 rounded-lg mb-3"
        style={{
          background: "rgba(15, 23, 42, 0.04)",
          border: "1px solid rgba(15, 23, 42, 0.06)",
        }}
      >
        {(["req", "res"] as const).map((k) => {
          const active = tab === k;
          return (
            <button
              key={k}
              onClick={() => setTab(k)}
              className="px-3 py-1 rounded-md text-[11px] font-mono tracking-[0.02em] transition-colors cursor-pointer"
              style={{
                background: active ? "#0F172A" : "transparent",
                color: active ? "#FFFFFF" : "#64748B",
              }}
            >
              {k === "req" ? "request" : "response"}
            </button>
          );
        })}
      </div>

      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={tab}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.18, ease: EASE }}
        >
          <TerminalBlockCompact
            title={tab === "req" ? "POST /v1/reports" : "response.json"}
            badge={tab === "res" ? "200 OK" : undefined}
            code={tab === "req" ? REQ : RES}
          />
        </motion.div>
      </AnimatePresence>
    </BentoCard>
  );
}

/* ── Main Export ───────────────────────────────────────────────────── */

export function FeatureTabs() {
  const noMotion = useReducedMotion() ?? false;

  return (
    <section
      id="features"
      className="py-24 lg:py-32"
    >
      <div className="mx-auto max-w-[1120px] px-6">
        {/* Heading */}
        <motion.div
          initial={noMotion ? false : { opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-15% 0px" }}
          transition={{ duration: 0.5, ease: EASE }}
          className="text-center mx-auto mb-16"
          style={{ maxWidth: "760px" }}
        >
          <span className="text-[12px] font-medium tracking-[0.1em] uppercase text-[#64748B]">
            Features
          </span>
          <h2
            className="inline-block leading-[1.05] bg-clip-text text-transparent mt-4"
            style={{
              fontSize: "clamp(36px, 5vw, 56px)",
              fontWeight: 600,
              letterSpacing: "-0.03em",
              backgroundImage:
                "linear-gradient(120deg, #1E1B4B 0%, #4C1D95 32%, #6C47FF 58%, #DB2777 100%)",
              WebkitBackgroundClip: "text",
            }}
          >
            One upload. Four outputs.
          </h2>
          <p className="mt-5 text-[16px] leading-relaxed text-[#64748B]">
            Coverage map, severity-ranked findings, PDF report, and API — all
            from a single APK.
          </p>
        </motion.div>

        {/* Bento grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <CoverageCard />
          <FindingsCard />
          <PdfCard />
          <ApiCard />
        </div>
      </div>
    </section>
  );
}
