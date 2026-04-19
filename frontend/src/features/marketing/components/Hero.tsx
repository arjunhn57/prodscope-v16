import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  motion,
  useMotionValue,
  useMotionTemplate,
  useAnimationFrame,
  useReducedMotion,
  type MotionValue,
} from "framer-motion";
import { ArrowRight, Zap } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Picture } from "@/components/ui/Picture";
import { usePageActive } from "@/lib/useVisibility";

const DotLottieReact = lazy(() =>
  import("@lottiefiles/dotlottie-react").then((m) => ({ default: m.DotLottieReact }))
);

/* ── Grid Pattern (from infinite-grid) ─────────────────────────────────────── */

function GridPattern({
  id,
  offsetX,
  offsetY,
}: {
  id: string;
  offsetX: MotionValue<number>;
  offsetY: MotionValue<number>;
}) {
  return (
    <svg width="100%" height="100%">
      <defs>
        <motion.pattern
          id={id}
          width="40"
          height="40"
          patternUnits="userSpaceOnUse"
          x={offsetX}
          y={offsetY}
        >
          <path
            d="M 40 0 L 0 0 0 40"
            fill="none"
            stroke="#64748B"
            strokeWidth="1"
          />
        </motion.pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${id})`} />
    </svg>
  );
}

/* ── App Icon Marquee Rows ─────────────────────────────────────────────────── */

const ICONS_ROW_1 = [
  "/app-icons/slack.svg",
  "/app-icons/discord.png",
  "/app-icons/github.png",
  "/app-icons/whatsapp.png",
  "/app-icons/x.svg",
  "/app-icons/youtube.svg",
  "/app-icons/netflix.png",
  "/app-icons/zoom.svg",
  "/app-icons/linkedin.png",
];

const ICONS_ROW_2 = [
  "/app-icons/telegram.svg",
  "/app-icons/instagram.png",
  "/app-icons/spotify.png",
  "/app-icons/uber.svg",
  "/app-icons/pinterest.png",
  "/app-icons/paypal.png",
  "/app-icons/dropbox.svg",
  "/app-icons/tiktok.png",
  "/app-icons/twitch.svg",
];

function repeat<T>(arr: T[], times: number): T[] {
  return Array.from({ length: times }).flatMap(() => arr);
}

function IconRow({
  icons,
  reverse = false,
}: {
  icons: string[];
  reverse?: boolean;
}) {
  const rowRef = useRef<HTMLDivElement>(null);
  const animClass = reverse ? "animate-marquee-reverse" : "animate-marquee";
  const items = repeat(icons, 2);

  const setPlaybackRate = (rate: number) => {
    if (!rowRef.current) return;
    const anims = rowRef.current.getAnimations({ subtree: true });
    anims.forEach((a) => { a.playbackRate = rate; });
  };

  const renderItems = () =>
    items.map((src, i) => (
      <div
        key={i}
        className="h-16 w-16 flex-shrink-0 rounded-full bg-white/70 flex items-center justify-center transition-transform duration-200 hover:scale-[1.12] hover:bg-white"
        style={{ border: "1px solid rgba(108, 71, 255, 0.08)" }}
      >
        <Picture src={src} alt="" width={36} height={36} className="h-9 w-9 object-contain" />
      </div>
    ));

  return (
    <div
      ref={rowRef}
      className="flex gap-10"
      onMouseEnter={() => setPlaybackRate(0.3)}
      onMouseLeave={() => setPlaybackRate(1)}
    >
      <div className={`flex shrink-0 gap-10 ${animClass}`}>
        {renderItems()}
      </div>
      <div className={`flex shrink-0 gap-10 ${animClass}`} aria-hidden="true">
        {renderItems()}
      </div>
    </div>
  );
}

/* ── Word Cycler ───────────────────────────────────────────────────────────── */

function LineCycler({
  prefix,
  words,
}: {
  prefix: string;
  words: string[];
}) {
  const [index, setIndex] = useState(0);
  const longest = words.reduce((a, b) => (a.length > b.length ? a : b), "");

  useEffect(() => {
    const id = setTimeout(() => {
      setIndex((prev) => (prev + 1) % words.length);
    }, 2500);
    return () => clearTimeout(id);
  }, [index, words.length]);

  return (
    <span className="inline-grid overflow-hidden pb-[0.18em]">
      {/* Invisible sizer */}
      <span className="invisible col-start-1 row-start-1 whitespace-nowrap">
        {prefix}<span className="font-bold">{longest}</span>
      </span>
      {words.map((word, i) => (
        <motion.span
          key={i}
          className="col-start-1 row-start-1 whitespace-nowrap"
          initial={{ opacity: 0, y: "-100%" }}
          animate={
            index === i
              ? { y: "0%", opacity: 1 }
              : { y: index > i ? "-110%" : "110%", opacity: 0 }
          }
          transition={{ type: "spring", stiffness: 220, damping: 26, mass: 0.6 }}
        >
          {prefix}
          <span
            className="font-semibold bg-clip-text text-transparent"
            style={{
              backgroundImage:
                "linear-gradient(120deg, #1E1B4B 0%, #4C1D95 28%, #6C47FF 58%, #DB2777 100%)",
              WebkitBackgroundClip: "text",
            }}
          >
            {word}
          </span>
        </motion.span>
      ))}
    </span>
  );
}

/* ── Main Hero ─────────────────────────────────────────────────────────────── */

export function Hero() {
  const navigate = useNavigate();
  const prefersReducedMotion = useReducedMotion();
  const noMotion = prefersReducedMotion ?? false;
  const pageActive = usePageActive();

  const containerRef = useRef<HTMLDivElement>(null);
  const mouseX = useMotionValue(0);
  const mouseY = useMotionValue(0);
  const gridOffsetX = useMotionValue(0);
  const gridOffsetY = useMotionValue(0);

  const [heroVisible, setHeroVisible] = useState(true);
  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      ([entry]) => setHeroVisible(entry.isIntersecting),
      { rootMargin: "50px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const cyclingWords = useMemo(
    () => [
      "Find the bugs.",
      "Spot UX flaws.",
      "Catch crashes.",
      "Map dead ends.",
      "Prove coverage.",
      "Rank the risks.",
    ],
    []
  );

  function handleMouseMove(e: React.MouseEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    mouseX.set(e.clientX - rect.left);
    mouseY.set(e.clientY - rect.top);
  }

  useAnimationFrame(() => {
    if (noMotion || !heroVisible || !pageActive) return;
    gridOffsetX.set((gridOffsetX.get() + 0.5) % 40);
    gridOffsetY.set((gridOffsetY.get() + 0.5) % 40);
  });

  const maskImage = useMotionTemplate`radial-gradient(300px circle at ${mouseX}px ${mouseY}px, black, transparent)`;

  return (
    <section
      ref={containerRef}
      onMouseMove={handleMouseMove}
      className="relative min-h-dvh flex flex-col items-center justify-center overflow-hidden bg-bg-primary"
    >
      {/* ── Z-0: Infinite Grid Background ──────────────────────────────── */}
      <div className="absolute inset-0 z-0 opacity-[0.06]">
        <GridPattern id="hero-grid-bg" offsetX={gridOffsetX} offsetY={gridOffsetY} />
      </div>

      {/* Mouse-reveal layer (always rendered, animation gated separately) */}
      <motion.div
        className="absolute inset-0 z-0 opacity-40"
        style={{ maskImage, WebkitMaskImage: maskImage }}
      >
        <GridPattern id="hero-grid-reveal" offsetX={gridOffsetX} offsetY={gridOffsetY} />
      </motion.div>

      {/* Corner glow orbs */}
      <div className="absolute inset-0 pointer-events-none z-0">
        <div className="absolute right-[-20%] top-[-20%] w-[40%] h-[40%] rounded-full bg-orange-500/40 blur-[120px]" />
        <div className="absolute right-[10%] top-[-10%] w-[20%] h-[20%] rounded-full bg-indigo-500/30 blur-[100px]" />
        <div className="absolute left-[-10%] bottom-[-20%] w-[40%] h-[40%] rounded-full bg-blue-500/40 blur-[120px]" />
      </div>

      {/* ── Z-10: Hero Content ─────────────────────────────────────────── */}
      <div className="relative z-10 mx-auto max-w-[1120px] w-full px-6 pt-28 pb-8 md:pt-36 md:pb-12">
        <div className="flex flex-col items-center text-center">
          {/* Overline pill */}
          <motion.span
            initial={noMotion ? {} : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.1 }}
            className="inline-flex items-center gap-2 px-4 py-1.5 mb-8 text-xs font-medium tracking-[0.12em] uppercase rounded-full border border-border-default bg-bg-secondary text-accent"
          >
            <Zap className="w-3.5 h-3.5" />
            Automated App Analysis
          </motion.span>

          {/* Headline with word cycling */}
          <h1 className="font-heading text-[40px] md:text-[56px] lg:text-[72px] font-semibold tracking-[-0.025em] leading-[1.05] max-w-3xl mx-auto text-text-primary">
            <motion.span
              initial={noMotion ? {} : { opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.2 }}
            >
              Drop your APK.
            </motion.span>
            <br />
            <motion.span
              initial={noMotion ? {} : { opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.4 }}
            >
              <LineCycler prefix="" words={cyclingWords} />
            </motion.span>
          </h1>

          {/* Subtitle */}
          <motion.p
            initial={noMotion ? {} : { opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.6 }}
            className="text-base md:text-lg text-text-secondary leading-relaxed mt-6 max-w-[560px] mx-auto"
          >
            Upload your APK and get a full analysis report
            &mdash; no SDK, no scripts, no setup required.
          </motion.p>

          {/* Dual CTAs */}
          <motion.div
            initial={noMotion ? {} : { opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{
              type: "spring",
              stiffness: 200,
              damping: 20,
              delay: 0.8,
            }}
            className="mt-8 flex flex-col sm:flex-row gap-3"
          >
            <Button
              size="lg"
              onClick={() => navigate("/login")}
              className="gap-2.5"
              style={{
                background: "#1A1A2E",
                boxShadow:
                  "0 2px 8px rgba(26,26,46,0.3), 0 1px 2px rgba(26,26,46,0.2)",
              }}
            >
              <span
                aria-hidden="true"
                className="-ml-0.5 inline-flex items-center justify-center shrink-0"
                style={{ width: 22, height: 22 }}
              >
                <Suspense fallback={<span style={{ width: "100%", height: "100%" }} />}>
                  <DotLottieReact
                    src="/android-logo.lottie"
                    autoplay
                    loop
                    style={{ width: "100%", height: "100%" }}
                  />
                </Suspense>
              </span>
              Analyze Your App &mdash; Free
              <ArrowRight className="w-4 h-4" />
            </Button>
            <Button
              variant="secondary"
              size="lg"
              onClick={() => navigate("/r/sample")}
              className="gap-2"
            >
              See Sample Report
            </Button>
          </motion.div>

          {/* Trust line */}
          <motion.p
            initial={noMotion ? {} : { opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 1.1, duration: 0.5 }}
            className="mt-5 text-xs text-text-muted tracking-wide"
          >
            No SDK required &middot; Under 15 min &middot; Free to start
          </motion.p>
        </div>
      </div>

      {/* ── Z-5: Scrolling Icon Marquee ────────────────────────────────── */}
      <motion.div
        initial={noMotion ? {} : { opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, delay: 1.2 }}
        className="relative z-5 w-full mt-4 pb-0 overflow-hidden"
      >
        {/* Editorial "Tested on" rule — reframes marquee as target environments */}
        <div className="flex items-center justify-center gap-4 mb-5 px-6">
          <span className="h-px w-12 bg-gradient-to-r from-transparent to-[rgba(15,23,42,0.18)]" />
          <span
            className="text-[11px] font-medium uppercase tracking-[0.24em]"
            style={{
              color: "rgba(15,23,42,0.45)",
              fontFamily: "var(--font-label)",
            }}
          >
            Tested on
          </span>
          <span className="h-px w-12 bg-gradient-to-l from-transparent to-[rgba(15,23,42,0.18)]" />
        </div>

        <div className="space-y-6">
          <IconRow icons={ICONS_ROW_1} />
          <IconRow icons={ICONS_ROW_2} reverse />
        </div>

      </motion.div>
    </section>
  );
}
