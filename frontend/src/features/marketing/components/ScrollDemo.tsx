import React, { useEffect, useRef, useState } from "react";
import {
  AnimatePresence,
  motion,
  useInView,
  useReducedMotion,
} from "framer-motion";
import {
  Eye,
  Navigation,
  AlertTriangle,
  LayoutGrid,
  Smartphone,
  ShieldCheck,
} from "lucide-react";
import { PhoneMockup } from "./PhoneMockup";
import type { ScreenData } from "./PhoneMockup";
import { useInViewport, usePageActive } from "@/lib/useVisibility";

const EASE_OUT_QUINT: [number, number, number, number] = [0.22, 1, 0.36, 1];

/* ── Screen data for the phone mockup ─────────────────────────────────────── */

const SCREENS: ScreenData[] = [
  { name: "Onboarding", image: "/mockup-screens/1.png" },
  { name: "Personalize", image: "/mockup-screens/2.png" },
  { name: "Subscription", image: "/mockup-screens/3.png" },
  { name: "Login", image: "/mockup-screens/4.png" },
  { name: "SignUp", image: "/mockup-screens/5.png" },
  { name: "Chats", image: "/mockup-screens/6.png" },
  { name: "Conversation", image: "/mockup-screens/7.png" },
  { name: "Map", image: "/mockup-screens/8.png" },
  { name: "Checkout", image: "/mockup-screens/9.png" },
  { name: "Settings", image: "/mockup-screens/10.png" },
];

/* ── Discovery feed (the narrative on the left) ──────────────────────────── */

interface FeedItemData {
  icon: React.ReactNode;
  title: string;
  description: string;
  type: "discovery" | "finding" | "coverage";
  badge?: string;
  screen?: string;
}

const FEED_ITEMS: FeedItemData[] = [
  {
    icon: <Eye className="w-[18px] h-[18px]" />,
    title: "Onboarding flow detected",
    description:
      "Found onboarding screen with 'Next' CTA. Mapping initial user journey and element hierarchy.",
    type: "discovery",
    screen: "Onboarding",
  },
  {
    icon: <Navigation className="w-[18px] h-[18px]" />,
    title: "Navigated through sign-up funnel",
    description:
      "Traversed Personalize → Subscription screens. 3 pricing tiers detected, all CTAs tappable.",
    type: "discovery",
    screen: "Subscription",
  },
  {
    icon: <AlertTriangle className="w-[18px] h-[18px]" />,
    title: "No password validation",
    description:
      "Login allows empty password submission. No inline error displayed.",
    type: "finding",
    badge: "High Priority",
    screen: "Login",
  },
  {
    icon: <Smartphone className="w-[18px] h-[18px]" />,
    title: "Chat screens explored",
    description:
      "Navigated to Chats list and individual conversation. Bottom nav bar consistent across 4 screens.",
    type: "discovery",
    screen: "Chats",
  },
  {
    icon: <ShieldCheck className="w-[18px] h-[18px]" />,
    title: "Map & Checkout validated",
    description:
      "Location screen renders correctly. Checkout flow has proper step indicators and card selection.",
    type: "discovery",
    screen: "Checkout",
  },
  {
    icon: <LayoutGrid className="w-[18px] h-[18px]" />,
    title: "10 screens mapped",
    description:
      "98% coverage achieved. All critical flows analyzed. 1 finding flagged.",
    type: "coverage",
    badge: "Complete",
  },
];

const ACCENT_MAP: Record<FeedItemData["type"], { dot: string; icon: string; iconBg: string; accent: string; badgeBg: string; badgeText: string }> = {
  discovery: {
    dot: "#7C3AED",
    icon: "#6C47FF",
    iconBg: "rgba(124, 58, 237, 0.08)",
    accent: "rgba(124, 58, 237, 0.14)",
    badgeBg: "",
    badgeText: "",
  },
  finding: {
    dot: "#EF4444",
    icon: "#DC2626",
    iconBg: "rgba(239, 68, 68, 0.08)",
    accent: "rgba(239, 68, 68, 0.14)",
    badgeBg: "rgba(239, 68, 68, 0.10)",
    badgeText: "#DC2626",
  },
  coverage: {
    dot: "#10B981",
    icon: "#059669",
    iconBg: "rgba(16, 185, 129, 0.08)",
    accent: "rgba(16, 185, 129, 0.14)",
    badgeBg: "rgba(16, 185, 129, 0.10)",
    badgeText: "#059669",
  },
};

/* ── Progress ring around AI avatar ──────────────────────────────────────── */

function ProgressRing({ progress }: { progress: number }) {
  const r = 22;
  const circ = 2 * Math.PI * r;
  const offset = circ * (1 - progress);

  return (
    <svg
      className="absolute inset-0 -rotate-90"
      width="46"
      height="46"
      viewBox="0 0 46 46"
    >
      {/* Track */}
      <circle
        cx="23" cy="23" r={r}
        fill="none"
        stroke="rgba(124, 58, 237, 0.12)"
        strokeWidth="2.5"
      />
      {/* Progress arc */}
      <motion.circle
        cx="23" cy="23" r={r}
        fill="none"
        stroke="#6C47FF"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeDasharray={circ}
        animate={{ strokeDashoffset: offset }}
        transition={{ duration: 0.6, ease: EASE_OUT_QUINT }}
      />
    </svg>
  );
}

/* ── SVG timeline that draws in ──────────────────────────────────────────── */

function TimelineLine() {
  const ref = useRef<SVGSVGElement>(null);
  const isInView = useInView(ref, { once: true, margin: "-60px" });

  return (
    <svg
      ref={ref}
      className="absolute left-[18px] top-[52px] bottom-4 w-[3px]"
      style={{ height: "calc(100% - 68px)" }}
      preserveAspectRatio="none"
    >
      <defs>
        <linearGradient id="timeline-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="rgba(124, 58, 237, 0.30)" />
          <stop offset="60%" stopColor="rgba(124, 58, 237, 0.12)" />
          <stop offset="100%" stopColor="rgba(124, 58, 237, 0)" />
        </linearGradient>
      </defs>
      <motion.line
        x1="1.5" y1="0" x2="1.5" y2="100%"
        stroke="url(#timeline-grad)"
        strokeWidth="1.5"
        initial={{ pathLength: 0 }}
        animate={isInView ? { pathLength: 1 } : { pathLength: 0 }}
        transition={{ duration: 1.6, ease: EASE_OUT_QUINT, delay: 0.2 }}
      />
    </svg>
  );
}

/* ── Desktop: Auto-cycling phone with live feed ───────────────────────────── */

function DesktopScrollDemo() {
  const [screenIdx, setScreenIdx] = useState(0);
  const [scanning, setScanning] = useState(false);
  const [scanCount, setScanCount] = useState(0);
  const [rootRef, inView] = useInViewport<HTMLDivElement>({ rootMargin: "100px" });
  const pageActive = usePageActive();

  useEffect(() => {
    if (!inView || !pageActive) return;
    const id = window.setInterval(() => {
      setScanning(true);
      setScanCount((c) => c + 1);
      window.setTimeout(() => {
        setScreenIdx((prev) => (prev + 1) % SCREENS.length);
        setScanning(false);
      }, 900);
    }, 2700);
    return () => window.clearInterval(id);
  }, [inView, pageActive]);

  const currentScreenName = SCREENS[screenIdx]?.name ?? "";
  const progress = (screenIdx + 1) / SCREENS.length;

  return (
    <div ref={rootRef} className="mx-auto max-w-[1120px] w-full px-6 py-16">
      <div className="flex items-start gap-12 lg:gap-20">
        {/* Left: Live activity feed */}
        <div
          className="flex-1 relative rounded-2xl px-5 py-6"
          style={{
            background: "linear-gradient(135deg, rgba(248, 245, 255, 0.50), rgba(255, 255, 255, 0.30))",
            border: "1px solid rgba(124, 58, 237, 0.08)",
            boxShadow: "0 8px 40px rgba(124, 58, 237, 0.06), inset 0 1px 0 rgba(255,255,255,0.7)",
            backdropFilter: "blur(12px)",
          }}
        >
          {/* SVG timeline that draws in */}
          <TimelineLine />

          {/* Feed header with progress ring */}
          <div className="flex items-center gap-3.5 mb-7 pl-0.5">
            <div className="relative z-10 w-[46px] h-[46px] flex items-center justify-center">
              <ProgressRing progress={progress} />
              <motion.div
                className="w-[34px] h-[34px] rounded-full flex items-center justify-center"
                style={{
                  background: "linear-gradient(135deg, #6C47FF, #A78BFA)",
                  boxShadow: "0 4px 16px rgba(124, 58, 237, 0.30)",
                }}
              >
                <span className="text-white text-[12px] font-bold">AI</span>
              </motion.div>
            </div>
            <div>
              <p className="text-[15px] font-semibold text-text-primary">Live Analysis Feed</p>
              <div className="flex items-center gap-1.5 mt-0.5">
                <motion.div
                  className="w-1.5 h-1.5 rounded-full bg-emerald-500"
                  animate={{ opacity: [1, 0.4, 1] }}
                  transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
                />
                <span className="text-[12px] text-text-muted">
                  Screen {screenIdx + 1}/{SCREENS.length} — {currentScreenName}
                </span>
              </div>
            </div>
          </div>

          {/* Feed items */}
          <div className="flex flex-col gap-3">
            {FEED_ITEMS.map((item, i) => (
              <FeedCard
                key={i}
                item={item}
                index={i}
                active={item.screen === currentScreenName}
              />
            ))}
          </div>
        </div>

        {/* Right: Auto-cycling phone */}
        <div className="shrink-0 sticky top-32">
          <div className="relative overflow-hidden rounded-[28px]">
            <PhoneMockup activeScreen={screenIdx} screens={SCREENS} />
            <ScanOverlay scanning={scanning} direction={scanCount % 2 === 0 ? "down" : "up"} />
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Scan overlay ────────────────────────────────────────────────────────── */

function ScanOverlay({ scanning, direction }: { scanning: boolean; direction: "down" | "up" }) {
  const isDown = direction === "down";

  return (
    <AnimatePresence>
      {scanning && (
        <motion.div
          key={`scan-${direction}`}
          aria-hidden="true"
          className="absolute inset-0 pointer-events-none z-20"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
        >
          {/* Scanned region — purple wash that grows behind the bar */}
          <motion.div
            className="absolute inset-x-0"
            style={{
              [isDown ? "top" : "bottom"]: 0,
              background: isDown
                ? "linear-gradient(to bottom, rgba(124, 58, 237, 0.12), rgba(124, 58, 237, 0.06))"
                : "linear-gradient(to top, rgba(124, 58, 237, 0.12), rgba(124, 58, 237, 0.06))",
            }}
            initial={{ height: "0%" }}
            animate={{ height: "100%" }}
            transition={{ duration: 0.9, ease: "easeInOut" }}
          />

          {/* Scanning bar — the bright edge that sweeps */}
          <motion.div
            className="absolute inset-x-0"
            style={{ height: 48 }}
            initial={{ [isDown ? "top" : "bottom"]: "-48px" }}
            animate={{ [isDown ? "top" : "bottom"]: "100%" }}
            transition={{ duration: 0.9, ease: "easeInOut" }}
          >
            {/* Bright core line */}
            <div
              className="absolute inset-x-0 top-1/2 -translate-y-1/2"
              style={{
                height: 3,
                background:
                  "linear-gradient(to right, transparent 2%, rgba(167, 139, 250, 0.95) 25%, rgba(255, 255, 255, 0.9) 50%, rgba(167, 139, 250, 0.95) 75%, transparent 98%)",
              }}
            />
            {/* Inner glow */}
            <div
              className="absolute inset-x-0 top-1/2 -translate-y-1/2"
              style={{
                height: 16,
                background:
                  "linear-gradient(to right, transparent 5%, rgba(124, 58, 237, 0.5) 30%, rgba(167, 139, 250, 0.6) 50%, rgba(124, 58, 237, 0.5) 70%, transparent 95%)",
                filter: "blur(4px)",
              }}
            />
            {/* Outer glow */}
            <div
              className="absolute inset-x-0 top-1/2 -translate-y-1/2"
              style={{
                height: 48,
                background:
                  "radial-gradient(ellipse 80% 100% at center, rgba(124, 58, 237, 0.25), transparent)",
                filter: "blur(8px)",
              }}
            />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/* ── Mobile: Auto-cycling phone + scan line ───────────────────────────────── */

function MobileScrollDemo() {
  const [screenIdx, setScreenIdx] = useState(0);
  const [scanning, setScanning] = useState(false);
  const [scanCount, setScanCount] = useState(0);
  const [rootRef, inView] = useInViewport<HTMLDivElement>({ rootMargin: "100px" });
  const pageActive = usePageActive();

  useEffect(() => {
    if (!inView || !pageActive) return;
    const id = window.setInterval(() => {
      setScanning(true);
      setScanCount((c) => c + 1);
      window.setTimeout(() => {
        setScreenIdx((prev) => (prev + 1) % SCREENS.length);
        setScanning(false);
      }, 900);
    }, 2750);
    return () => window.clearInterval(id);
  }, [inView, pageActive]);

  return (
    <div ref={rootRef} className="flex justify-center">
      <div className="relative overflow-hidden rounded-[28px]">
        <PhoneMockup activeScreen={screenIdx} screens={SCREENS} />
        <ScanOverlay scanning={scanning} direction={scanCount % 2 === 0 ? "down" : "up"} />
      </div>
    </div>
  );
}

/* ── Feed card with timeline dot + active state ──────────────────────────── */

function FeedCard({
  item,
  index,
  active,
}: {
  item: FeedItemData;
  index: number;
  active: boolean;
}) {
  const prefersReducedMotion = useReducedMotion();
  const colors = ACCENT_MAP[item.type];

  return (
    <motion.div
      initial={prefersReducedMotion ? {} : { opacity: 0, x: -20, filter: "blur(4px)" }}
      whileInView={{ opacity: 1, x: 0, filter: "blur(0px)" }}
      viewport={{ once: true, margin: "-30px" }}
      transition={{
        duration: 0.5,
        delay: index * 0.1,
        ease: EASE_OUT_QUINT,
      }}
      className="relative flex gap-4 pl-0.5"
    >
      {/* Timeline dot with pulse ring when active */}
      <div className="relative z-10 shrink-0 mt-5 w-[18px] flex justify-center">
        <AnimatePresence>
          {active && (
            <motion.div
              className="absolute rounded-full"
              style={{
                width: 22,
                height: 22,
                top: -6,
                left: -2,
                border: `2px solid ${colors.dot}`,
              }}
              initial={{ scale: 0.5, opacity: 0 }}
              animate={{ scale: [1, 1.5, 1], opacity: [0.6, 0, 0.6] }}
              exit={{ scale: 0.5, opacity: 0 }}
              transition={{ duration: 1.8, repeat: Infinity, ease: "easeOut" }}
            />
          )}
        </AnimatePresence>
        <motion.div
          className="w-[10px] h-[10px] rounded-full"
          style={{
            background: colors.dot,
            boxShadow: `0 0 0 3px rgba(255,255,255,0.9), 0 0 8px ${colors.dot}40`,
          }}
          animate={active ? { scale: [1, 1.3, 1] } : { scale: 1 }}
          transition={active ? { duration: 1.2, repeat: Infinity, ease: "easeInOut" } : {}}
        />
      </div>

      {/* Card — lights up when active */}
      <motion.div
        className="flex-1 rounded-xl px-5 py-4"
        animate={{
          background: active
            ? "linear-gradient(135deg, rgba(255, 255, 255, 0.95), rgba(245, 241, 255, 0.88))"
            : "linear-gradient(135deg, rgba(255, 255, 255, 0.85), rgba(248, 245, 255, 0.60))",
          borderColor: active ? colors.dot : colors.accent,
          boxShadow: active
            ? `0 16px 48px rgba(124, 58, 237, 0.14), 0 4px 12px rgba(124, 58, 237, 0.08), inset 0 1px 0 rgba(255,255,255,0.9), inset 0 -1px 0 rgba(124, 58, 237, 0.06)`
            : `0 8px 32px rgba(124, 58, 237, 0.08), 0 2px 8px rgba(124, 58, 237, 0.04), inset 0 1px 0 rgba(255,255,255,0.8)`,
        }}
        style={{
          border: `1px solid ${colors.accent}`,
          backdropFilter: "blur(10px)",
        }}
        transition={{ duration: 0.4, ease: EASE_OUT_QUINT }}
        whileHover={{
          y: -2,
          boxShadow: `0 20px 48px rgba(124, 58, 237, 0.14), 0 4px 12px rgba(124, 58, 237, 0.08), inset 0 1px 0 rgba(255,255,255,0.9), inset 0 -1px 0 rgba(124, 58, 237, 0.06)`,
        }}
      >
        {/* Active indicator bar at top */}
        <motion.div
          className="absolute top-0 left-5 right-5 h-[2px] rounded-full"
          style={{ background: colors.dot }}
          animate={{ opacity: active ? 1 : 0, scaleX: active ? 1 : 0 }}
          transition={{ duration: 0.3, ease: EASE_OUT_QUINT }}
        />

        {/* Top row: icon + title + badge */}
        <div className="flex items-center gap-3">
          <motion.div
            className="shrink-0 w-9 h-9 rounded-xl flex items-center justify-center"
            style={{
              color: colors.icon,
              boxShadow: `inset 0 0 0 1px ${colors.accent}`,
            }}
            animate={{
              background: active ? `${colors.dot}18` : colors.iconBg,
            }}
            transition={{ duration: 0.3 }}
          >
            {item.icon}
          </motion.div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h4 className="text-[15px] font-semibold text-text-primary leading-snug">
                {item.title}
              </h4>
              {item.badge && (
                <span
                  className="text-[11px] font-semibold px-2.5 py-0.5 rounded-full"
                  style={{
                    background: colors.badgeBg,
                    color: colors.badgeText,
                  }}
                >
                  {item.badge}
                </span>
              )}
            </div>
          </div>
          {item.screen && (
            <motion.span
              className="shrink-0 text-[11px] font-medium px-2.5 py-1 rounded-lg"
              animate={{
                background: active ? "rgba(124, 58, 237, 0.12)" : "rgba(124, 58, 237, 0.06)",
                color: active ? "#5B21B6" : "#6C47FF",
              }}
              transition={{ duration: 0.3 }}
            >
              {item.screen}
            </motion.span>
          )}
        </div>

        {/* Description */}
        <p className="text-[13px] text-text-secondary leading-relaxed mt-2.5 pl-12">
          {item.description}
        </p>
      </motion.div>
    </motion.div>
  );
}

/* ── Main export ──────────────────────────────────────────────────────────── */

export function ScrollDemo() {
  return (
    <section className="bg-transparent">
      <div className="pt-20 md:pt-32 pb-4 md:pb-0">
        {/* Section header */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5, ease: EASE_OUT_QUINT }}
          className="text-center mb-12 md:mb-0 px-6"
        >
          <span className="text-xs font-medium text-text-muted tracking-[0.1em] uppercase">
            Watch It Work
          </span>
          <h2
            className="inline-block text-[clamp(36px,5vw,56px)] font-semibold tracking-[-0.03em] leading-[1.05] bg-clip-text text-transparent mt-3"
            style={{
              backgroundImage: "linear-gradient(120deg, #1E1B4B 0%, #4C1D95 32%, #6C47FF 58%, #DB2777 100%)",
              WebkitBackgroundClip: "text",
            }}
          >
            Watch ProdScope think.
          </h2>
          <p className="text-base text-text-secondary mt-3 max-w-md mx-auto">
            Screen by screen, it surfaces findings and maps coverage in real time.
          </p>
        </motion.div>

        {/* Desktop layout (sticky scrollytelling) */}
        <div className="hidden md:block">
          <DesktopScrollDemo />
        </div>

        {/* Mobile layout (stacked cards) */}
        <div className="md:hidden px-6 pb-16">
          <MobileScrollDemo />
        </div>
      </div>
    </section>
  );
}
