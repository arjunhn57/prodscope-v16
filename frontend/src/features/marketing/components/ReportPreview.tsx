import { useEffect, useRef, useState } from "react";
import {
  motion,
  useInView,
  useMotionValue,
  useReducedMotion,
  useScroll,
  useTransform,
  animate,
} from "framer-motion";
import {
  Sparkles,
  Map,
  AlertTriangle,
  LayoutGrid,
  CheckCircle,
  Clock,
  ArrowRight,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { REPORT_COLORS, REPORT_GRADIENTS } from "../../report/tokens";

const ACCENT = REPORT_COLORS.accent;
const TEXT_PRIMARY = REPORT_COLORS.textPrimary;
const TEXT_MUTED = REPORT_COLORS.textMuted;
const EASE_OUT: [number, number, number, number] = [0.22, 1, 0.36, 1];
const HEADLINE_GRADIENT = REPORT_GRADIENTS.editorialHeadline;

/* ── Animated Score Ring ──────────────────────────────────────────────────── */

function ScoreRing({ triggered }: { triggered: boolean }) {
  const progress = useMotionValue(0);
  const display = useTransform(progress, (v) => Math.round(v).toString());
  const circumference = 2 * Math.PI * 52;
  const dashOffset = useTransform(
    progress,
    (v) => circumference - (v / 100) * circumference,
  );

  useEffect(() => {
    if (!triggered) return;
    const controls = animate(progress, 87, {
      duration: 1.2,
      delay: 0.6,
      ease: EASE_OUT,
    });
    return () => controls.stop();
  }, [triggered, progress]);

  return (
    <div className="relative" style={{ width: 120, height: 120 }}>
      <svg viewBox="0 0 120 120" className="w-full h-full -rotate-90">
        <circle
          cx="60"
          cy="60"
          r="52"
          fill="none"
          stroke="#F1F5F9"
          strokeWidth="7"
        />
        <motion.circle
          cx="60"
          cy="60"
          r="52"
          fill="none"
          stroke={ACCENT}
          strokeWidth="7"
          strokeLinecap="round"
          strokeDasharray={circumference}
          style={{ strokeDashoffset: dashOffset }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <motion.span
          className="text-[32px] font-bold leading-none"
          style={{ color: TEXT_PRIMARY, letterSpacing: "-0.03em" }}
        >
          {display}
        </motion.span>
        <span className="text-[12px] mt-0.5" style={{ color: TEXT_MUTED }}>
          /100
        </span>
      </div>
    </div>
  );
}

/* ── Stat Counter ─────────────────────────────────────────────────────────── */

interface StatDef {
  icon: typeof LayoutGrid;
  value: number;
  label: string;
  suffix?: string;
}

const STATS: readonly StatDef[] = [
  { icon: LayoutGrid, value: 142, label: "Screens", suffix: "" },
  { icon: AlertTriangle, value: 23, label: "Findings", suffix: "" },
  { icon: CheckCircle, value: 87, label: "Coverage", suffix: "%" },
  { icon: Clock, value: 4.2, label: "Avg time", suffix: " min" },
];

function StatCounter({
  stat,
  triggered,
  delay,
}: {
  stat: StatDef;
  triggered: boolean;
  delay: number;
}) {
  const mv = useMotionValue(0);
  const text = useTransform(mv, (v) => {
    const rounded = stat.value % 1 === 0 ? Math.round(v) : Number(v.toFixed(1));
    return `${rounded}${stat.suffix}`;
  });
  const Icon = stat.icon;

  useEffect(() => {
    if (!triggered) return;
    const controls = animate(mv, stat.value, {
      duration: 1.0,
      delay,
      ease: EASE_OUT,
    });
    return () => controls.stop();
  }, [triggered, mv, stat.value, delay]);

  return (
    <div className="flex items-center gap-2.5">
      <div
        className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
        style={{ background: "rgba(108, 71, 255, 0.08)" }}
      >
        <Icon size={15} color={ACCENT} strokeWidth={2} />
      </div>
      <div>
        <motion.div
          className="text-[18px] font-bold leading-none"
          style={{ color: TEXT_PRIMARY }}
        >
          {text}
        </motion.div>
        <div className="text-[11px] mt-0.5" style={{ color: TEXT_MUTED }}>
          {stat.label}
        </div>
      </div>
    </div>
  );
}

/* ── Coverage Node ────────────────────────────────────────────────────────── */

interface ScreenNode {
  name: string;
  visited: boolean;
}

const SCREEN_NODES: readonly ScreenNode[] = [
  { name: "Home", visited: true },
  { name: "Search", visited: true },
  { name: "Cart", visited: true },
  { name: "Profile", visited: true },
  { name: "Settings", visited: true },
  { name: "Login", visited: true },
  { name: "Onboard", visited: false },
  { name: "Payment", visited: true },
];

function CoverageNode({
  node,
  delay,
  triggered,
  reduceMotion,
}: {
  node: ScreenNode;
  delay: number;
  triggered: boolean;
  reduceMotion: boolean;
}) {
  return (
    <motion.div
      initial={reduceMotion ? {} : { opacity: 0, scale: 0.8 }}
      animate={
        reduceMotion
          ? {}
          : triggered
            ? { opacity: 1, scale: 1 }
            : { opacity: 0, scale: 0.8 }
      }
      transition={{ duration: 0.35, delay, ease: EASE_OUT }}
      className="flex flex-col items-center gap-1"
    >
      <div
        className="w-[52px] h-[52px] rounded-lg flex items-center justify-center relative"
        style={{
          background: node.visited
            ? "linear-gradient(135deg, #EDE9FE, #DDD6FE)"
            : "#F8FAFC",
          border: node.visited
            ? "2px solid rgba(108, 71, 255, 0.4)"
            : "2px dashed #CBD5E1",
          opacity: node.visited ? 1 : 0.6,
        }}
      >
        <LayoutGrid
          size={18}
          color={node.visited ? ACCENT : "#94A3B8"}
          strokeWidth={1.5}
        />
        {node.visited && (
          <div
            className="absolute -top-1 -right-1 w-4 h-4 rounded-full flex items-center justify-center"
            style={{ background: "#10B981" }}
          >
            <CheckCircle size={10} color="white" strokeWidth={2.5} />
          </div>
        )}
      </div>
      <span
        className="text-[10px] font-medium"
        style={{ color: node.visited ? TEXT_PRIMARY : "#94A3B8" }}
      >
        {node.name}
      </span>
    </motion.div>
  );
}

/* ── Finding Row ──────────────────────────────────────────────────────────── */

interface FindingDef {
  severity: "Critical" | "Warning" | "Info";
  title: string;
}

const SEVERITY_STYLES: Record<
  FindingDef["severity"],
  { bg: string; text: string }
> = {
  Critical: { bg: "#FEE2E2", text: "#DC2626" },
  Warning: { bg: "#FEF3C7", text: "#D97706" },
  Info: { bg: "#DBEAFE", text: "#2563EB" },
};

const FINDINGS: readonly FindingDef[] = [
  { severity: "Critical", title: "Missing alt text on 12 images" },
  { severity: "Warning", title: "Slow network request on Cart (3.2s)" },
  { severity: "Info", title: "Unused permission: CAMERA" },
];

function FindingRow({
  finding,
  delay,
  triggered,
  reduceMotion,
  showBorder,
}: {
  finding: FindingDef;
  delay: number;
  triggered: boolean;
  reduceMotion: boolean;
  showBorder: boolean;
}) {
  const style = SEVERITY_STYLES[finding.severity];
  return (
    <motion.div
      initial={reduceMotion ? {} : { opacity: 0, x: -12 }}
      animate={
        reduceMotion
          ? {}
          : triggered
            ? { opacity: 1, x: 0 }
            : { opacity: 0, x: -12 }
      }
      transition={{ duration: 0.4, delay, ease: EASE_OUT }}
      className="flex items-center gap-3 py-3"
      style={{
        borderBottom: showBorder ? "1px solid #F1F5F9" : "none",
      }}
    >
      <span
        className="text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0"
        style={{ background: style.bg, color: style.text }}
      >
        {finding.severity}
      </span>
      <span className="text-[13px] truncate" style={{ color: TEXT_PRIMARY }}>
        {finding.title}
      </span>
    </motion.div>
  );
}

/* ── Report Document ──────────────────────────────────────────────────────── */

function ReportDocument({
  triggered,
  reduceMotion,
}: {
  triggered: boolean;
  reduceMotion: boolean;
}) {
  return (
    <div
      className="w-full rounded-2xl bg-white overflow-hidden"
      style={{
        boxShadow:
          "0 25px 60px -12px rgba(76, 29, 149, 0.15), 0 12px 28px -8px rgba(124, 58, 237, 0.1), 0 0 0 1px rgba(124, 58, 237, 0.06)",
      }}
    >
      {/* Header bar */}
      <div
        className="flex items-center justify-between px-6 py-3"
        style={{ background: ACCENT }}
      >
        <span className="text-[13px] font-bold text-white tracking-wide">
          ProdScope
        </span>
        <span className="text-[12px] text-white/70">App Analysis Report</span>
      </div>

      {/* App identification */}
      <div
        className="flex items-center gap-3 px-6 py-4"
        style={{ borderBottom: "1px solid #F1F5F9" }}
      >
        <div
          className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0"
          style={{
            background: "linear-gradient(135deg, #6C47FF, #A78BFA)",
          }}
        >
          <span className="text-white text-[16px] font-bold">Z</span>
        </div>
        <div className="flex-1 min-w-0">
          <div
            className="text-[15px] font-bold leading-tight"
            style={{ color: TEXT_PRIMARY }}
          >
            Zomato
          </div>
          <div
            className="text-[12px] font-mono truncate"
            style={{ color: TEXT_MUTED }}
          >
            com.application.zomato
          </div>
        </div>
        <span
          className="text-[11px] font-medium px-2 py-0.5 rounded-full shrink-0"
          style={{ background: "#F1F0FB", color: ACCENT }}
        >
          v17.5.2
        </span>
      </div>

      {/* Executive summary */}
      <div className="px-6 py-6 flex items-center gap-6 flex-wrap">
        <ScoreRing triggered={triggered} />
        <div className="flex-1 min-w-[200px] grid grid-cols-2 gap-x-4 gap-y-4">
          {STATS.map((stat, i) => (
            <StatCounter
              key={stat.label}
              stat={stat}
              triggered={triggered}
              delay={0.8 + i * 0.1}
            />
          ))}
        </div>
      </div>

      {/* Coverage map */}
      <div className="px-6 py-5" style={{ borderTop: "1px solid #F1F5F9" }}>
        <div className="flex items-center justify-between mb-4">
          <span
            className="text-[13px] font-semibold"
            style={{ color: TEXT_PRIMARY }}
          >
            Screen Coverage
          </span>
          <span
            className="text-[11px] font-semibold px-2 py-0.5 rounded-full"
            style={{ background: "#F1F0FB", color: ACCENT }}
          >
            87%
          </span>
        </div>
        <div className="grid grid-cols-4 gap-3">
          {SCREEN_NODES.map((node, i) => (
            <CoverageNode
              key={node.name}
              node={node}
              delay={1.0 + i * 0.06}
              triggered={triggered}
              reduceMotion={reduceMotion}
            />
          ))}
        </div>
      </div>

      {/* Top findings */}
      <div className="px-6 py-5" style={{ borderTop: "1px solid #F1F5F9" }}>
        <div className="flex items-center justify-between mb-1">
          <span
            className="text-[13px] font-semibold"
            style={{ color: TEXT_PRIMARY }}
          >
            Key Findings
          </span>
          <span className="text-[11px]" style={{ color: TEXT_MUTED }}>
            23 total
          </span>
        </div>
        {FINDINGS.map((f, i) => (
          <FindingRow
            key={f.title}
            finding={f}
            delay={1.3 + i * 0.1}
            triggered={triggered}
            reduceMotion={reduceMotion}
            showBorder={i < FINDINGS.length - 1}
          />
        ))}
      </div>

      {/* Footer */}
      <div
        className="flex items-center justify-between px-6 py-3"
        style={{ background: "#FAFAFA", borderTop: "1px solid #F1F5F9" }}
      >
        <span className="text-[11px]" style={{ color: TEXT_MUTED }}>
          Generated by ProdScope AI
        </span>
        <span className="text-[11px]" style={{ color: TEXT_MUTED }}>
          April 2026
        </span>
      </div>
    </div>
  );
}

/* ── Floating Callout ─────────────────────────────────────────────────────── */

interface CalloutDef {
  icon: typeof Sparkles;
  eyebrow: string;
  headline: string;
  body: string;
  accent: string;
}

const CALLOUTS: readonly CalloutDef[] = [
  {
    icon: Sparkles,
    eyebrow: "Health Score",
    headline: "87 / 100",
    body: "Above the industry average for e-commerce Android apps.",
    accent: ACCENT,
  },
  {
    icon: Map,
    eyebrow: "Screen Coverage",
    headline: "142 / 163",
    body: "Every reachable state mapped — no manual test script needed.",
    accent: "#10B981",
  },
  {
    icon: AlertTriangle,
    eyebrow: "Severity Triage",
    headline: "3 · 8 · 12",
    body: "Critical, warning, and informational findings — ranked by impact.",
    accent: "#F59E0B",
  },
];

function Callout({
  callout,
  index,
  triggered,
  reduceMotion,
  side,
}: {
  callout: CalloutDef;
  index: number;
  triggered: boolean;
  reduceMotion: boolean;
  side: "left" | "right";
}) {
  const Icon = callout.icon;
  const fromLeft = side === "left";
  return (
    <motion.div
      initial={
        reduceMotion
          ? {}
          : { opacity: 0, x: fromLeft ? -24 : 24 }
      }
      animate={
        reduceMotion
          ? {}
          : triggered
            ? { opacity: 1, x: 0 }
            : { opacity: 0, x: fromLeft ? -24 : 24 }
      }
      transition={{ duration: 0.55, delay: 0.9 + index * 0.18, ease: EASE_OUT }}
      whileHover={reduceMotion ? {} : { x: fromLeft ? -3 : 3 }}
      className={`relative ${fromLeft ? "pl-4 text-left" : "pr-4 text-left"}`}
      style={{
        [fromLeft ? "borderLeft" : "borderRight"]:
          `2px solid ${callout.accent}`,
      }}
    >
      {/* Accent dot marker */}
      <div
        aria-hidden="true"
        className={`absolute top-0 ${fromLeft ? "-left-[5px]" : "-right-[5px]"} w-2 h-2 rounded-full`}
        style={{
          background: callout.accent,
          boxShadow: `0 0 12px ${callout.accent}66`,
        }}
      />
      {/* Pulsing ring */}
      {triggered && !reduceMotion && (
        <motion.div
          aria-hidden="true"
          className={`absolute top-0 ${fromLeft ? "-left-[5px]" : "-right-[5px]"} w-2 h-2 rounded-full pointer-events-none`}
          style={{ background: callout.accent }}
          initial={{ scale: 1, opacity: 0.6 }}
          animate={{ scale: 3, opacity: 0 }}
          transition={{
            duration: 2.4,
            repeat: Infinity,
            delay: 1.2 + index * 0.4,
            ease: "easeOut",
          }}
        />
      )}

      <div className="flex items-center gap-1.5 mb-1.5">
        <Icon size={12} color={callout.accent} strokeWidth={2.4} />
        <span
          className="uppercase tracking-[0.1em] font-semibold"
          style={{
            fontFamily: "var(--font-label)",
            fontSize: "10.5px",
            color: callout.accent,
          }}
        >
          {callout.eyebrow}
        </span>
      </div>
      <div
        className="font-bold leading-none tabular-nums mb-2"
        style={{
          fontSize: "22px",
          letterSpacing: "-0.02em",
          color: TEXT_PRIMARY,
        }}
      >
        {callout.headline}
      </div>
      <p
        className="leading-[1.5]"
        style={{
          fontSize: "12.5px",
          color: TEXT_MUTED,
          maxWidth: 220,
        }}
      >
        {callout.body}
      </p>
    </motion.div>
  );
}

/* ── Main Section ─────────────────────────────────────────────────────────── */

export function ReportPreview() {
  const navigate = useNavigate();
  const sectionRef = useRef<HTMLElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const reduceMotion = useReducedMotion() ?? false;
  const [triggered, setTriggered] = useState(false);
  const inView = useInView(contentRef, { once: true, margin: "-15% 0px" });

  useEffect(() => {
    if (inView) setTriggered(true);
  }, [inView]);

  const { scrollYProgress } = useScroll({
    target: sectionRef,
    offset: ["start end", "end start"],
  });
  const docY = useTransform(
    scrollYProgress,
    [0, 1],
    reduceMotion ? [0, 0] : [-16, 16],
  );
  const shadowY = useTransform(
    scrollYProgress,
    [0, 1],
    reduceMotion ? [0, 0] : [12, -12],
  );

  return (
    <section
      ref={sectionRef}
      id="sample-report"
      role="region"
      aria-label="Sample report preview"
      className="relative w-full overflow-hidden py-20 md:py-28 px-6"
      style={{ background: "transparent" }}
    >

      <div className="relative mx-auto max-w-[1120px]">
        {/* Heading */}
        <motion.div
          initial={reduceMotion ? false : { opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-15% 0px" }}
          transition={{ duration: 0.6, ease: EASE_OUT }}
          className="text-center mb-14 md:mb-18"
        >
          <h2
            className="inline-block text-[clamp(36px,5vw,56px)] font-semibold tracking-[-0.03em] leading-[1.05] bg-clip-text text-transparent"
            style={{
              backgroundImage: HEADLINE_GRADIENT,
              WebkitBackgroundClip: "text",
            }}
          >
            See what you get.
          </h2>
          <p
            className="mt-5 mx-auto leading-[1.6]"
            style={{
              color: TEXT_MUTED,
              fontSize: "clamp(16px, 1.8vw, 20px)",
              maxWidth: 640,
            }}
          >
            Every report delivers a complete analysis — coverage map,
            severity-ranked findings, and an overall health score. Here's a
            preview.
          </p>
        </motion.div>

        {/* Content: 3-col grid at lg, stacked below */}
        <div
          ref={contentRef}
          className="grid gap-6 lg:gap-8 grid-cols-1 lg:grid-cols-[minmax(0,200px)_minmax(0,640px)_minmax(0,200px)] items-start justify-items-center"
        >
          {/* Left callout (Score) — desktop only */}
          <div className="hidden lg:flex flex-col justify-start pt-20">
            <Callout
              callout={CALLOUTS[0]}
              index={0}
              triggered={triggered}
              reduceMotion={reduceMotion}
              side="left"
            />
          </div>

          {/* Center: Report document with parallax shadow card */}
          <div className="relative w-full max-w-[640px] order-1 lg:order-none">
            {/* Shadow card — offset behind, counter-parallax */}
            <motion.div
              aria-hidden="true"
              style={{ y: shadowY }}
              className="absolute inset-0 pointer-events-none hidden md:block"
            >
              <motion.div
                initial={reduceMotion ? {} : { opacity: 0, scale: 0.95 }}
                animate={
                  reduceMotion
                    ? {}
                    : triggered
                      ? { opacity: 1, scale: 1 }
                      : { opacity: 0, scale: 0.95 }
                }
                transition={{ duration: 0.9, delay: 0.05, ease: EASE_OUT }}
                className="w-full h-full rounded-2xl"
                style={{
                  background:
                    "linear-gradient(135deg, rgba(108, 71, 255, 0.08), rgba(219, 39, 119, 0.06))",
                  transform: "translate(14px, 14px) rotate(1.5deg)",
                  boxShadow:
                    "0 30px 60px -15px rgba(76, 29, 149, 0.12), 0 0 0 1px rgba(124, 58, 237, 0.06)",
                  filter: "blur(1px)",
                }}
              />
            </motion.div>

            {/* Foreground report */}
            <motion.div
              style={{ y: docY }}
              className="relative z-10"
            >
              <motion.div
                initial={reduceMotion ? {} : { opacity: 0, y: 32 }}
                animate={
                  reduceMotion
                    ? {}
                    : triggered
                      ? { opacity: 1, y: 0 }
                      : { opacity: 0, y: 32 }
                }
                transition={{ duration: 0.7, delay: 0.15, ease: EASE_OUT }}
                className="relative"
              >
                {/* Scan line */}
                {triggered && !reduceMotion && (
                  <motion.div
                    aria-hidden="true"
                    className="absolute left-0 right-0 h-[2px] pointer-events-none z-20"
                    style={{
                      background:
                        "linear-gradient(to right, transparent, rgba(124, 58, 237, 0.6), transparent)",
                      boxShadow: "0 0 16px rgba(124, 58, 237, 0.5)",
                    }}
                    initial={{ top: "-2%", opacity: 0 }}
                    animate={{ top: "102%", opacity: [0, 1, 1, 0] }}
                    transition={{ duration: 2.2, delay: 0.4, ease: "linear" }}
                  />
                )}
                <ReportDocument
                  triggered={triggered}
                  reduceMotion={reduceMotion}
                />
              </motion.div>
            </motion.div>
          </div>

          {/* Right callouts (Coverage + Findings) — desktop only */}
          <div className="hidden lg:flex flex-col gap-14 pt-40">
            <Callout
              callout={CALLOUTS[1]}
              index={1}
              triggered={triggered}
              reduceMotion={reduceMotion}
              side="right"
            />
            <Callout
              callout={CALLOUTS[2]}
              index={2}
              triggered={triggered}
              reduceMotion={reduceMotion}
              side="right"
            />
          </div>

          {/* Callouts — mobile/tablet (below document) */}
          <div className="lg:hidden grid grid-cols-1 md:grid-cols-3 gap-6 w-full max-w-[640px] order-2 mt-2">
            {CALLOUTS.map((c, i) => (
              <Callout
                key={c.eyebrow}
                callout={c}
                index={i}
                triggered={triggered}
                reduceMotion={reduceMotion}
                side="left"
              />
            ))}
          </div>
        </div>

        {/* CTA */}
        <motion.div
          initial={reduceMotion ? false : { opacity: 0, y: 12 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-10% 0px" }}
          transition={{ duration: 0.5, delay: 0.3, ease: EASE_OUT }}
          className="mt-16 text-center"
        >
          <p className="text-[14px] mb-4" style={{ color: TEXT_MUTED }}>
            Get a report like this for your app. Free.
          </p>
          <button
            onClick={() => navigate("/login")}
            className="inline-flex items-center gap-2 px-6 py-3 rounded-xl font-semibold text-white cursor-pointer transition-transform hover:-translate-y-0.5"
            style={{
              background: HEADLINE_GRADIENT,
              boxShadow:
                "0 10px 24px -8px rgba(124, 58, 237, 0.45), 0 4px 12px -4px rgba(219, 39, 119, 0.25)",
            }}
          >
            Analyze your APK
            <ArrowRight className="w-4 h-4" />
          </button>
        </motion.div>
      </div>
    </section>
  );
}
