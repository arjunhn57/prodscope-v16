import { useEffect, useMemo, type CSSProperties } from "react";
import {
  animate,
  motion,
  useMotionValue,
  useReducedMotion,
  useTransform,
  type MotionValue,
} from "framer-motion";
import { AlertTriangle, CheckCircle2, type LucideIcon } from "lucide-react";

/* ═════════════════════════════════════════════════════════════════════════
   Living Graph — an animated visualization of an app being analyzed.
   600×540 canvas, 14s looping sequence:
     Discover → Connect → Pulse → Analyze → Dissolve, then loops.
   ══════════════════════════════════════════════════════════════════════ */

const LOOP_DURATION = 14000;
const CANVAS_W = 600;
const CANVAS_H = 540;

const NODE_W = 64;
const NODE_H = 140;

const NODE_DISCOVER_STAGGER = 400;
const NODE_DISCOVER_DURATION = 600;

const EDGE_CONNECT_START = 3500;
const EDGE_CONNECT_STAGGER = 300;
const EDGE_CONNECT_DURATION = 700;

const PULSE_RING_DURATION = 1400;

const BADGE_FADE_DURATION = 400;

const DISSOLVE_START = 12000;
const DISSOLVE_DURATION = 2000;

interface GraphNode {
  id: string;
  x: number;
  y: number;
  image: string;
  label: string;
  isRoot?: boolean;
}

interface GraphEdge {
  from: string;
  to: string;
}

const NODES: readonly GraphNode[] = [
  { id: "launch", x: 300, y: 90, image: "/mockup-screens/1.png", label: "Launch", isRoot: true },
  { id: "home", x: 150, y: 265, image: "/mockup-screens/2.png", label: "Home" },
  { id: "feed", x: 300, y: 265, image: "/mockup-screens/4.png", label: "Feed" },
  { id: "profile", x: 450, y: 265, image: "/mockup-screens/6.png", label: "Profile" },
  { id: "checkout", x: 140, y: 440, image: "/mockup-screens/8.png", label: "Checkout" },
  { id: "chat", x: 300, y: 440, image: "/mockup-screens/9.png", label: "Chat" },
  { id: "settings", x: 460, y: 440, image: "/mockup-screens/3.png", label: "Settings" },
] as const;

const EDGES: readonly GraphEdge[] = [
  { from: "launch", to: "home" },
  { from: "launch", to: "feed" },
  { from: "launch", to: "profile" },
  { from: "home", to: "checkout" },
  { from: "feed", to: "checkout" },
  { from: "feed", to: "chat" },
  { from: "profile", to: "chat" },
  { from: "profile", to: "settings" },
] as const;

const NODES_BY_ID: Record<string, GraphNode> = NODES.reduce(
  (acc, n) => {
    acc[n.id] = n;
    return acc;
  },
  {} as Record<string, GraphNode>,
);

/* ───────── Helpers ──────────────────────────────────────────────────── */

function clamp01(x: number): number {
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Cubic ease-out — fast start, gentle finish. */
function easeOut(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

/** Ease-out-back — overshoots slightly, nice for pop-ins. */
function easeOutBack(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

/** Standard dissolve curve applied to the tail of the loop. */
function dissolveFactor(t: number): number {
  if (t < DISSOLVE_START) return 1;
  if (t >= DISSOLVE_START + DISSOLVE_DURATION) return 0;
  const p = (t - DISSOLVE_START) / DISSOLVE_DURATION;
  return 1 - easeOut(p);
}

/* ───────── Edge ─────────────────────────────────────────────────────── */

interface EdgePathProps {
  from: GraphNode;
  to: GraphNode;
  index: number;
  elapsed: MotionValue<number>;
  noMotion: boolean;
}

function EdgePath({ from, to, index, elapsed, noMotion }: EdgePathProps) {
  const start = EDGE_CONNECT_START + index * EDGE_CONNECT_STAGGER;
  const end = start + EDGE_CONNECT_DURATION;

  // Perpendicular offset for curvature — makes every edge a gentle bezier.
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.max(1, Math.sqrt(dx * dx + dy * dy));
  // Alternate side of curvature by index parity for variety.
  const sign = index % 2 === 0 ? 1 : -1;
  const curveOffset = 22 * sign;
  const midX = (from.x + to.x) / 2 + (-dy / len) * curveOffset;
  const midY = (from.y + to.y) / 2 + (dx / len) * curveOffset;

  // Trim endpoints so the curve doesn't visually enter the node card.
  const trim = 8;
  const fromX = from.x + (dx / len) * trim;
  const fromY = from.y + (dy / len) * trim;
  const toX = to.x - (dx / len) * trim;
  const toY = to.y - (dy / len) * trim;

  const d = `M ${fromX} ${fromY} Q ${midX} ${midY} ${toX} ${toY}`;

  const pathLength = useTransform(elapsed, (t) => {
    if (noMotion) return 1;
    if (t < start) return 0;
    if (t >= end) return 1;
    return easeOut((t - start) / EDGE_CONNECT_DURATION);
  });

  const opacity = useTransform(elapsed, (t) => {
    if (noMotion) return 0.95;
    const draw = t < start ? 0 : t >= end ? 1 : (t - start) / EDGE_CONNECT_DURATION;
    return draw * dissolveFactor(t);
  });

  return (
    <motion.path
      d={d}
      fill="none"
      stroke="url(#lg-edge-grad)"
      strokeWidth={2}
      strokeLinecap="round"
      style={{
        pathLength,
        opacity,
        filter: "drop-shadow(0 1px 2px rgba(108, 71, 255, 0.35))",
      }}
    />
  );
}

/* ───────── Pulse Ring ────────────────────────────────────────────────── */

interface PulseRingProps {
  node: GraphNode;
  delay: number;
  elapsed: MotionValue<number>;
  noMotion: boolean;
}

function PulseRing({ node, delay, elapsed, noMotion }: PulseRingProps) {
  const radius = useTransform(elapsed, (t) => {
    if (noMotion) return 0;
    if (t < delay) return 0;
    if (t >= delay + PULSE_RING_DURATION) return 0;
    const p = (t - delay) / PULSE_RING_DURATION;
    return lerp(8, 72, easeOut(p));
  });

  const opacity = useTransform(elapsed, (t) => {
    if (noMotion) return 0;
    if (t < delay || t >= delay + PULSE_RING_DURATION) return 0;
    const p = (t - delay) / PULSE_RING_DURATION;
    // Fade in then out
    return p < 0.3 ? p / 0.3 : 1 - (p - 0.3) / 0.7;
  });

  return (
    <motion.circle
      cx={node.x}
      cy={node.y}
      r={radius}
      fill="none"
      stroke="#6C47FF"
      strokeWidth={1.5}
      style={{ opacity }}
    />
  );
}

/* ───────── Node Card ────────────────────────────────────────────────── */

interface NodeCardProps {
  node: GraphNode;
  index: number;
  elapsed: MotionValue<number>;
  noMotion: boolean;
}

function NodeCard({ node, index, elapsed, noMotion }: NodeCardProps) {
  const start = index * NODE_DISCOVER_STAGGER;
  const end = start + NODE_DISCOVER_DURATION;

  const opacity = useTransform(elapsed, (t) => {
    if (noMotion) return 1;
    let base = 0;
    if (t >= end) base = 1;
    else if (t >= start) base = easeOut((t - start) / NODE_DISCOVER_DURATION);
    return base * dissolveFactor(t);
  });

  const scale = useTransform(elapsed, (t) => {
    if (noMotion) return 1;
    if (t >= end) return 1;
    if (t >= start) {
      const p = (t - start) / NODE_DISCOVER_DURATION;
      return lerp(0.85, 1, easeOut(p));
    }
    return 0.85;
  });

  const style: CSSProperties = {
    position: "absolute",
    left: node.x - NODE_W / 2,
    top: node.y - NODE_H / 2,
    width: NODE_W,
    height: NODE_H,
    borderRadius: 10,
    overflow: "hidden",
    border: "1px solid rgba(124, 58, 237, 0.16)",
    background: "linear-gradient(180deg, #FFFFFF 0%, #FAF7FF 100%)",
    boxShadow: [
      "0 10px 24px -6px rgba(124, 58, 237, 0.18)",
      "0 4px 8px -2px rgba(124, 58, 237, 0.10)",
      "inset 0 1px 0 rgba(255, 255, 255, 0.9)",
    ].join(", "),
    transformOrigin: "center",
    willChange: "transform, opacity",
  };

  return (
    <motion.div style={{ ...style, opacity, scale }}>
      <img
        src={node.image}
        alt=""
        draggable={false}
        className="h-full w-full object-cover"
        style={{ display: "block" }}
      />
      {/* Tiny inner tint to unify card look with the rest of the page */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          background: "linear-gradient(180deg, rgba(124, 58, 237, 0.00) 60%, rgba(124, 58, 237, 0.08) 100%)",
        }}
      />
      {node.isRoot && <RootPulseDot noMotion={noMotion} />}
    </motion.div>
  );
}

function RootPulseDot({ noMotion }: { noMotion: boolean }) {
  return (
    <motion.div
      className="absolute left-1/2 -translate-x-1/2 rounded-full"
      style={{
        top: 6,
        width: 8,
        height: 8,
        background: "#6C47FF",
        boxShadow: "0 0 0 4px rgba(108, 71, 255, 0.18), 0 0 10px rgba(108, 71, 255, 0.55)",
      }}
      animate={
        noMotion
          ? { opacity: 1 }
          : {
              opacity: [0.6, 1, 0.6],
              scale: [0.9, 1.1, 0.9],
            }
      }
      transition={
        noMotion
          ? {}
          : {
              duration: 1.8,
              repeat: Infinity,
              ease: "easeInOut",
            }
      }
    />
  );
}

/* ───────── Leaf Badge ────────────────────────────────────────────────── */

interface LeafBadgeProps {
  node: GraphNode;
  variant: "bug" | "coverage";
  delay: number;
  elapsed: MotionValue<number>;
  noMotion: boolean;
}

interface BadgeStyle {
  Icon: LucideIcon;
  color: string;
  ring: string;
  bg: string;
}

const BADGE_STYLES: Record<"bug" | "coverage", BadgeStyle> = {
  bug: {
    Icon: AlertTriangle,
    color: "#DC2626",
    ring: "rgba(239, 68, 68, 0.35)",
    bg: "#FFFFFF",
  },
  coverage: {
    Icon: CheckCircle2,
    color: "#059669",
    ring: "rgba(16, 185, 129, 0.35)",
    bg: "#FFFFFF",
  },
};

function LeafBadge({ node, variant, delay, elapsed, noMotion }: LeafBadgeProps) {
  const cfg = BADGE_STYLES[variant];
  const Icon = cfg.Icon;

  const opacity = useTransform(elapsed, (t) => {
    if (noMotion) return 1;
    if (t < delay) return 0;
    if (t < delay + BADGE_FADE_DURATION) return clamp01((t - delay) / BADGE_FADE_DURATION);
    return dissolveFactor(t);
  });

  const scale = useTransform(elapsed, (t) => {
    if (noMotion) return 1;
    if (t < delay) return 0.4;
    if (t < delay + BADGE_FADE_DURATION) {
      const p = (t - delay) / BADGE_FADE_DURATION;
      return lerp(0.4, 1, easeOutBack(p));
    }
    return 1;
  });

  return (
    <motion.div
      className="absolute flex h-6 w-6 items-center justify-center rounded-full"
      style={{
        left: node.x + NODE_W / 2 - 10,
        top: node.y - NODE_H / 2 - 8,
        background: cfg.bg,
        border: `1.5px solid ${cfg.color}`,
        boxShadow: `0 0 0 3px ${cfg.ring}, 0 4px 10px -2px rgba(0, 0, 0, 0.12)`,
        transformOrigin: "center",
        opacity,
        scale,
      }}
    >
      <Icon className="h-3 w-3" strokeWidth={2.8} style={{ color: cfg.color }} />
    </motion.div>
  );
}

/* ───────── Ambient Scan Cursor ──────────────────────────────────────── */

function ScanCursor({ noMotion }: { noMotion: boolean }) {
  if (noMotion) {
    return null;
  }

  // Figure-8-ish path by combining two sin waves of different frequencies.
  // Keyframe sampling over a 16s loop.
  const xKeys = [300, 420, 420, 300, 180, 180, 300];
  const yKeys = [270, 340, 200, 270, 340, 200, 270];

  return (
    <motion.div
      aria-hidden="true"
      className="pointer-events-none absolute rounded-full"
      style={{
        width: 120,
        height: 120,
        marginLeft: -60,
        marginTop: -60,
        background: "radial-gradient(circle, rgba(124, 58, 237, 0.28) 0%, rgba(124, 58, 237, 0.0) 70%)",
        filter: "blur(14px)",
        mixBlendMode: "plus-lighter",
      }}
      animate={{ x: xKeys, y: yKeys }}
      transition={{
        duration: 16,
        repeat: Infinity,
        ease: "linear",
        times: [0, 0.17, 0.33, 0.5, 0.67, 0.83, 1],
      }}
    />
  );
}

/* ───────── Main Component ───────────────────────────────────────────── */

interface LivingGraphProps {
  className?: string;
  style?: CSSProperties;
}

export function LivingGraph({ className, style }: LivingGraphProps) {
  const prefersReducedMotion = useReducedMotion();
  const noMotion = prefersReducedMotion ?? false;

  // Driving motion value. Resting-state value for reduced motion shows the
  // fully-revealed state just before dissolve (t ≈ 11 200 ms).
  const elapsed = useMotionValue(noMotion ? 11200 : 0);

  useEffect(() => {
    if (noMotion) return;
    elapsed.set(0);
    const controls = animate(elapsed, LOOP_DURATION, {
      duration: LOOP_DURATION / 1000,
      ease: "linear",
      repeat: Infinity,
      repeatType: "loop",
    });
    return () => controls.stop();
  }, [elapsed, noMotion]);

  const checkoutNode = useMemo(() => NODES_BY_ID["checkout"], []);
  const settingsNode = useMemo(() => NODES_BY_ID["settings"], []);

  return (
    <div
      className={className}
      style={{
        position: "relative",
        width: "100%",
        aspectRatio: `${CANVAS_W} / ${CANVAS_H}`,
        maxWidth: CANVAS_W,
        ...style,
      }}
    >
      {/* Decorative frame / backdrop */}
      <div
        aria-hidden="true"
        className="absolute inset-0 rounded-[20px] pointer-events-none"
        style={{
          border: "1px solid rgba(124, 58, 237, 0.14)",
          background:
            "linear-gradient(180deg, rgba(255, 255, 255, 0.55) 0%, rgba(250, 248, 255, 0.30) 100%)",
          boxShadow: [
            "0 30px 80px -20px rgba(124, 58, 237, 0.22)",
            "0 12px 28px -8px rgba(124, 58, 237, 0.14)",
            "inset 0 1px 0 rgba(255, 255, 255, 0.9)",
          ].join(", "),
          backdropFilter: "blur(10px)",
          WebkitBackdropFilter: "blur(10px)",
        }}
      />

      {/* Ambient scan cursor (behind everything, absorbs into frame) */}
      <div className="absolute inset-0 overflow-hidden rounded-[20px] pointer-events-none">
        <ScanCursor noMotion={noMotion} />
      </div>

      {/* SVG: edges + pulse rings */}
      <svg
        viewBox={`0 0 ${CANVAS_W} ${CANVAS_H}`}
        className="absolute inset-0 h-full w-full pointer-events-none"
        preserveAspectRatio="xMidYMid meet"
        role="presentation"
      >
        <defs>
          <linearGradient id="lg-edge-grad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#6C47FF" stopOpacity="0.95" />
            <stop offset="50%" stopColor="#DB2777" stopOpacity="0.75" />
            <stop offset="100%" stopColor="#6C47FF" stopOpacity="0.95" />
          </linearGradient>
        </defs>

        {EDGES.map((e, i) => (
          <EdgePath
            key={`${e.from}-${e.to}`}
            from={NODES_BY_ID[e.from]}
            to={NODES_BY_ID[e.to]}
            index={i}
            elapsed={elapsed}
            noMotion={noMotion}
          />
        ))}

        <PulseRing node={checkoutNode} delay={7300} elapsed={elapsed} noMotion={noMotion} />
        <PulseRing node={settingsNode} delay={7800} elapsed={elapsed} noMotion={noMotion} />
      </svg>

      {/* HTML: node cards */}
      {NODES.map((n, i) => (
        <NodeCard key={n.id} node={n} index={i} elapsed={elapsed} noMotion={noMotion} />
      ))}

      {/* HTML: leaf badges */}
      <LeafBadge node={checkoutNode} variant="bug" delay={9000} elapsed={elapsed} noMotion={noMotion} />
      <LeafBadge node={settingsNode} variant="coverage" delay={9300} elapsed={elapsed} noMotion={noMotion} />
    </div>
  );
}
