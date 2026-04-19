import { useRef } from "react";
import { motion, useReducedMotion, useInView } from "framer-motion";
import { AnimatedCounter } from "@/components/shared/AnimatedCounter";
import { AlertCircle, Clock, FileBarChart } from "lucide-react";

const EASE_OUT_QUINT: [number, number, number, number] = [0.22, 1, 0.36, 1];

/* ── Coverage Graph SVG ──────────────────────────────────────────────────── */

function CoverageGraph() {
  const ref = useRef<HTMLDivElement>(null);
  const isInView = useInView(ref, { once: true, margin: "-100px" });

  const nodes = [
    { x: 60, y: 40, label: "Login" },
    { x: 180, y: 40, label: "Home" },
    { x: 300, y: 40, label: "Feed" },
    { x: 60, y: 120, label: "Profile" },
    { x: 180, y: 120, label: "Settings" },
    { x: 300, y: 120, label: "Chat" },
    { x: 120, y: 80, label: "Search" },
    { x: 240, y: 80, label: "Detail" },
  ];

  const edges: [number, number][] = [
    [0, 1], [1, 2], [0, 3], [1, 4], [2, 5],
    [1, 6], [2, 7], [6, 7], [3, 4], [4, 5],
  ];

  return (
    <div ref={ref} className="w-full h-full flex items-center justify-center">
      <svg viewBox="0 0 360 160" className="w-full max-w-[360px]">
        {edges.map(([from, to], i) => (
          <motion.line
            key={`edge-${i}`}
            x1={nodes[from].x}
            y1={nodes[from].y}
            x2={nodes[to].x}
            y2={nodes[to].y}
            stroke="#8A6CFF"
            strokeWidth="1.5"
            strokeOpacity="0.25"
            initial={{ pathLength: 0, opacity: 0 }}
            animate={isInView ? { pathLength: 1, opacity: 1 } : { pathLength: 0, opacity: 0 }}
            transition={{ duration: 0.8, delay: 0.3 + i * 0.08, ease: EASE_OUT_QUINT }}
          />
        ))}

        {nodes.map((node, i) => (
          <g key={`node-${i}`}>
            <motion.circle
              cx={node.x}
              cy={node.y}
              r="16"
              fill="#F8FAFC"
              stroke="#8A6CFF"
              strokeWidth="1.5"
              initial={{ scale: 0, opacity: 0 }}
              animate={isInView ? { scale: 1, opacity: 1 } : { scale: 0, opacity: 0 }}
              transition={{
                type: "spring",
                stiffness: 200,
                damping: 15,
                delay: 0.1 + i * 0.06,
              }}
            />
            <motion.text
              x={node.x}
              y={node.y + 1}
              textAnchor="middle"
              dominantBaseline="central"
              className="text-[8px] font-medium"
              fill="#475569"
              initial={{ opacity: 0 }}
              animate={isInView ? { opacity: 1 } : { opacity: 0 }}
              transition={{ delay: 0.4 + i * 0.06 }}
            >
              {node.label}
            </motion.text>
          </g>
        ))}
      </svg>
    </div>
  );
}

/* ── Score Ring Cell ──────────────────────────────────────────────────────── */

function ScoreRingCell() {
  const ref = useRef<HTMLDivElement>(null);
  const isInView = useInView(ref, { once: true, margin: "-80px" });

  const size = 140;
  const strokeWidth = 6;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const score = 87;
  const offset = circumference - (score / 100) * circumference;

  return (
    <div ref={ref} className="flex flex-col items-center justify-center h-full gap-3">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="#E2E8F0"
            strokeWidth={strokeWidth}
          />
          <motion.circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="#8A6CFF"
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeDasharray={circumference}
            initial={{ strokeDashoffset: circumference }}
            animate={isInView ? { strokeDashoffset: offset } : { strokeDashoffset: circumference }}
            transition={{ duration: 1.5, ease: EASE_OUT_QUINT, delay: 0.3 }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <motion.span
            initial={{ opacity: 0, scale: 0.5 }}
            animate={isInView ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0.5 }}
            transition={{ delay: 0.6, type: "spring", stiffness: 150 }}
            className="text-4xl font-bold text-text-primary"
          >
            {score}
          </motion.span>
          <span className="text-xs text-text-muted">/100</span>
        </div>
      </div>
      <span className="text-sm font-medium text-accent">Analysis Score</span>
    </div>
  );
}

/* ── Counter Cell ────────────────────────────────────────────────────────── */

function CounterCell() {
  const ref = useRef<HTMLDivElement>(null);
  const isInView = useInView(ref, { once: true, margin: "-80px" });

  return (
    <div ref={ref} className="flex flex-col items-center justify-center h-full gap-2">
      <AlertCircle className="w-6 h-6 text-accent mb-1" />
      {isInView ? (
        <AnimatedCounter
          value={23}
          className="text-5xl font-bold text-text-primary"
        />
      ) : (
        <span className="text-5xl font-bold text-text-primary">0</span>
      )}
      <span className="text-sm text-text-secondary font-medium">Findings Detected</span>
      <div className="flex items-center gap-3 text-xs text-text-muted mt-1">
        <span className="text-red-500">3 high priority</span>
        <span>8 medium</span>
        <span>12 low</span>
      </div>
    </div>
  );
}

/* ── Report Cell ─────────────────────────────────────────────────────────── */

function ReportCell() {
  return (
    <div className="flex items-center justify-center h-full" style={{ perspective: 800 }}>
      <motion.div
        whileHover={{ rotateY: 0, y: -4 }}
        transition={{ type: "spring", stiffness: 200, damping: 25 }}
        className="w-full max-w-[200px]"
        style={{ transformStyle: "preserve-3d" }}
      >
        <div
          className="bg-bg-secondary border border-border-default rounded-xl p-4 space-y-3"
          style={{ transform: "rotateY(-6deg)" }}
        >
          <div className="flex items-center gap-2">
            <FileBarChart className="w-4 h-4 text-accent" />
            <span className="text-xs font-semibold text-text-primary">
              Analysis Report
            </span>
          </div>
          <div className="h-1.5 rounded-full bg-bg-muted overflow-hidden">
            <motion.div
              className="h-full rounded-full bg-accent"
              initial={{ width: 0 }}
              whileInView={{ width: "87%" }}
              viewport={{ once: true }}
              transition={{ duration: 1, delay: 0.5, ease: EASE_OUT_QUINT }}
            />
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-red-500" />
              <span className="text-[10px] text-text-muted">Empty state missing</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-amber-500" />
              <span className="text-[10px] text-text-muted">No alt text on avatar</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
              <span className="text-[10px] text-text-muted">Navigation validated</span>
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

/* ── Time Cell ───────────────────────────────────────────────────────────── */

function TimeCell() {
  const ref = useRef<HTMLDivElement>(null);
  const isInView = useInView(ref, { once: true, margin: "-80px" });

  return (
    <div ref={ref} className="flex flex-col items-center justify-center h-full gap-2">
      <Clock className="w-6 h-6 text-accent mb-1" />
      <motion.span
        initial={{ opacity: 0, scale: 0.8 }}
        animate={isInView ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0.8 }}
        transition={{ type: "spring", stiffness: 100, damping: 15, delay: 0.2 }}
        className="text-5xl font-bold text-text-primary"
      >
        &lt; 30
      </motion.span>
      <span className="text-sm text-text-secondary font-medium">
        Minutes to Report
      </span>
    </div>
  );
}

/* ── Main BentoGrid ──────────────────────────────────────────────────────── */

export function BentoGrid() {
  const prefersReducedMotion = useReducedMotion();

  const cells = [
    {
      component: <CoverageGraph />,
      className: "md:col-span-2",
      label: "Every screen. Every transition. Mapped.",
    },
    { component: <ScoreRingCell />, className: "", label: null },
    { component: <CounterCell />, className: "", label: null },
    { component: <ReportCell />, className: "", label: null },
    { component: <TimeCell />, className: "", label: null },
  ];

  return (
    <section id="features" className="py-24 md:py-32 bg-bg-primary">
      <div className="mx-auto max-w-[1120px] px-6">
        {/* Header */}
        <motion.div
          initial={prefersReducedMotion ? {} : { opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5, ease: EASE_OUT_QUINT }}
          className="text-center mb-16"
        >
          <span className="text-xs font-medium text-text-muted tracking-[0.1em] uppercase">
            What You Get
          </span>
          <h2 className="text-3xl md:text-[44px] font-semibold text-text-primary tracking-tight mt-3 leading-[1.15]">
            Everything in one run
          </h2>
        </motion.div>

        {/* Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {cells.map((cell, i) => (
            <motion.div
              key={i}
              initial={prefersReducedMotion ? {} : { opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-40px" }}
              transition={{
                duration: 0.5,
                delay: i * 0.1,
                ease: EASE_OUT_QUINT,
              }}
              whileHover={prefersReducedMotion ? {} : { y: -4 }}
              className={`surface-card p-6 md:p-8 min-h-[240px] transition-all duration-300 hover:shadow-[0_8px_30px_rgba(0,0,0,0.06)] ${cell.className}`}
            >
              {cell.component}
              {cell.label && (
                <p className="text-xs text-text-muted text-center mt-4 font-medium">
                  {cell.label}
                </p>
              )}
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
