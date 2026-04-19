import { useEffect, useRef } from "react";
import { animate, motion, useMotionValue } from "framer-motion";
import {
  CloudUpload,
  ScanSearch,
  FileCheck,
  type LucideIcon,
} from "lucide-react";
import { useInViewport, usePageActive } from "@/lib/useVisibility";

const ACCENT = "#6C47FF";
const TEXT_PRIMARY = "#0F172A";
const TEXT_MUTED = "#334155";

interface Step {
  number: string;
  title: string;
  body: string;
  icon: LucideIcon;
}

const STEPS: Step[] = [
  {
    number: "01",
    title: "Drop your APK.",
    body: "Drop your Android build or paste a Play Store link. No SDKs, no code changes, no account setup on the app side.",
    icon: CloudUpload,
  },
  {
    number: "02",
    title: "Watch it explore.",
    body: "ProdScope navigates your app automatically — taps, scrolls, fills forms, and captures every reachable state. Works on any app.",
    icon: ScanSearch,
  },
  {
    number: "03",
    title: "Share the report.",
    body: "A complete PDF with coverage map, findings, heatmaps, and screenshot gallery — ready to ship to your team or investors.",
    icon: FileCheck,
  },
];

interface IllustrationTileProps {
  icon: LucideIcon;
  floatDelay: number;
}

function IllustrationTile({ icon: Icon, floatDelay }: IllustrationTileProps) {
  return (
    <motion.div
      className="relative flex items-center justify-center w-[128px] h-[128px] rounded-[32px]"
      style={{
        background:
          "linear-gradient(135deg, rgba(255, 255, 255, 0.85), rgba(255, 255, 255, 0.55))",
        boxShadow:
          "0 20px 48px rgba(124, 58, 237, 0.14), 0 4px 12px rgba(124, 58, 237, 0.08), inset 0 1px 0 rgba(255, 255, 255, 0.9), inset 0 -1px 0 rgba(124, 58, 237, 0.06)",
        border: "1px solid rgba(124, 58, 237, 0.14)",
        backdropFilter: "blur(10px)",
      }}
      animate={{ y: [0, -6, 0] }}
      transition={{
        duration: 4.2,
        repeat: Infinity,
        ease: "easeInOut",
        delay: floatDelay,
      }}
    >
      <div
        aria-hidden="true"
        className="absolute inset-[14px] rounded-[22px] pointer-events-none"
        style={{
          background:
            "radial-gradient(circle at 30% 25%, rgba(124, 58, 237, 0.10), transparent 65%)",
        }}
      />
      <Icon
        size={54}
        strokeWidth={1.4}
        color={ACCENT}
        style={{ position: "relative" }}
      />
    </motion.div>
  );
}

interface ZigRowProps {
  step: Step;
  index: number;
  reverse: boolean;
}

function ZigRow({ step, index, reverse }: ZigRowProps) {
  const textBlock = (
    <div className={`text-center md:text-left ${reverse ? "md:order-2" : ""}`}>
      <div
        className="text-[44px] font-light leading-none"
        style={{ color: ACCENT, letterSpacing: "-0.04em" }}
      >
        {step.number}
      </div>
      <h3
        className="mt-3 text-[24px] font-semibold tracking-[-0.02em]"
        style={{ color: TEXT_PRIMARY }}
      >
        {step.title}
      </h3>
      <p
        className="mt-2 text-[15px] leading-[1.6] max-w-[420px] mx-auto md:mx-0"
        style={{ color: TEXT_MUTED }}
      >
        {step.body}
      </p>
    </div>
  );

  const mediaBlock = (
    <div className={`flex justify-center ${reverse ? "md:order-1" : ""}`}>
      <IllustrationTile icon={step.icon} floatDelay={index * 0.6} />
    </div>
  );

  return (
    <motion.div
      className="grid grid-cols-1 md:grid-cols-2 gap-8 md:gap-12 items-center"
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-15% 0px" }}
      transition={{ duration: 0.6, delay: index * 0.15 }}
    >
      {textBlock}
      {mediaBlock}
    </motion.div>
  );
}

export function HowItWorks() {
  const svgContainerRef = useRef<HTMLDivElement>(null);
  const path1Ref = useRef<SVGPathElement>(null);
  const path2Ref = useRef<SVGPathElement>(null);
  const dot1Ref = useRef<HTMLDivElement>(null);
  const dot2Ref = useRef<HTMLDivElement>(null);

  const dashOffset1 = useMotionValue(0);
  const dashOffset2 = useMotionValue(0);
  const [sectionRef, inView] = useInViewport<HTMLElement>({ rootMargin: "200px" });
  const pageActive = usePageActive();

  useEffect(() => {
    if (!inView || !pageActive) return;
    const controls1 = animate(dashOffset1, -12, {
      duration: 1.5,
      repeat: Infinity,
      ease: "linear",
    });
    const controls2 = animate(dashOffset2, -12, {
      duration: 1.5,
      repeat: Infinity,
      ease: "linear",
    });
    return () => {
      controls1.stop();
      controls2.stop();
    };
  }, [dashOffset1, dashOffset2, inView, pageActive]);

  useEffect(() => {
    if (!inView || !pageActive) return;
    const mql = window.matchMedia("(min-width: 768px)");
    let rafId = 0;
    const startedAt = performance.now();
    const DUR = 3000;

    const updateDot = (
      path: SVGPathElement | null,
      dot: HTMLDivElement | null,
      rect: DOMRect,
      phase: number,
    ): void => {
      if (!path || !dot) return;
      const length = path.getTotalLength();
      const point = path.getPointAtLength(phase * length);
      const px = (point.x / 100) * rect.width;
      const py = (point.y / 100) * rect.height;
      const fade = Math.sin(phase * Math.PI);
      dot.style.transform = `translate(${px - 6}px, ${py - 6}px)`;
      dot.style.opacity = String(fade);
    };

    const tick = (): void => {
      const elapsed = performance.now() - startedAt;
      const container = svgContainerRef.current;
      if (container) {
        const rect = container.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          const phase1 = (elapsed / DUR) % 1;
          const phase2 = ((elapsed + DUR / 2) / DUR) % 1;
          updateDot(path1Ref.current, dot1Ref.current, rect, phase1);
          updateDot(path2Ref.current, dot2Ref.current, rect, phase2);
        }
      }
      rafId = requestAnimationFrame(tick);
    };

    const start = (): void => {
      if (mql.matches && rafId === 0) {
        rafId = requestAnimationFrame(tick);
      }
    };
    const stop = (): void => {
      if (rafId !== 0) {
        cancelAnimationFrame(rafId);
        rafId = 0;
      }
    };
    const onChange = (): void => {
      if (mql.matches) start();
      else stop();
    };

    start();
    mql.addEventListener("change", onChange);
    return () => {
      mql.removeEventListener("change", onChange);
      stop();
    };
  }, [inView, pageActive]);

  return (
    <section
      ref={sectionRef}
      id="how-it-works"
      role="region"
      aria-label="How it works"
      className="relative w-full overflow-hidden py-24 lg:py-32 px-6"
      style={{ color: TEXT_PRIMARY }}
    >
      <div className="relative mx-auto max-w-[1120px]">
        {/* Header */}
        <div className="text-center">
          <motion.h2
            initial={{ opacity: 0, y: 28 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-20% 0px" }}
            transition={{ duration: 0.75, ease: [0.22, 0.61, 0.36, 1] }}
            className="inline-block text-[clamp(40px,5vw,64px)] font-semibold tracking-[-0.03em] leading-[1.02] bg-clip-text text-transparent"
            style={{
              backgroundImage:
                "linear-gradient(120deg, #1E1B4B 0%, #4C1D95 32%, #6C47FF 58%, #DB2777 100%)",
              WebkitBackgroundClip: "text",
            }}
          >
            How it works.
          </motion.h2>
          <p
            className="mt-5 text-[18px] leading-[1.55] max-w-[560px] mx-auto"
            style={{ color: TEXT_MUTED }}
          >
            Three steps. Zero setup. From APK to insight in under 15 minutes.
          </p>
        </div>

        {/* Zig-zag wrapper with absolutely-positioned connector SVG */}
        <div ref={svgContainerRef} className="relative mt-10">
          <svg
            className="hidden md:block absolute inset-0 w-full h-full pointer-events-none z-0"
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            overflow="visible"
            aria-hidden="true"
          >
            <motion.path
              ref={path1Ref}
              d="M 76 22 C 64 40, 36 18, 24 36"
              stroke={ACCENT}
              strokeWidth="2"
              strokeOpacity="0.5"
              strokeLinecap="round"
              strokeDasharray="6 6"
              fill="none"
              vectorEffect="non-scaling-stroke"
              style={{ strokeDashoffset: dashOffset1 }}
              initial={{ opacity: 0 }}
              whileInView={{ opacity: 1 }}
              viewport={{ once: true, margin: "-20% 0px" }}
              transition={{ duration: 0.8, ease: "easeOut", delay: 0.3 }}
            />
            <motion.path
              ref={path2Ref}
              d="M 24 58 C 36 78, 64 55, 76 75"
              stroke={ACCENT}
              strokeWidth="2"
              strokeOpacity="0.5"
              strokeLinecap="round"
              strokeDasharray="6 6"
              fill="none"
              vectorEffect="non-scaling-stroke"
              style={{ strokeDashoffset: dashOffset2 }}
              initial={{ opacity: 0 }}
              whileInView={{ opacity: 1 }}
              viewport={{ once: true, margin: "-20% 0px" }}
              transition={{ duration: 0.8, ease: "easeOut", delay: 0.9 }}
            />
          </svg>

          <div
            ref={dot1Ref}
            aria-hidden="true"
            className="hidden md:block absolute top-0 left-0 pointer-events-none"
            style={{
              width: "12px",
              height: "12px",
              borderRadius: "9999px",
              background: ACCENT,
              boxShadow: `0 0 12px ${ACCENT}, 0 0 24px rgba(124, 58, 237, 0.55)`,
              willChange: "transform, opacity",
              opacity: 0,
            }}
          />
          <div
            ref={dot2Ref}
            aria-hidden="true"
            className="hidden md:block absolute top-0 left-0 pointer-events-none"
            style={{
              width: "12px",
              height: "12px",
              borderRadius: "9999px",
              background: ACCENT,
              boxShadow: `0 0 12px ${ACCENT}, 0 0 24px rgba(124, 58, 237, 0.55)`,
              willChange: "transform, opacity",
              opacity: 0,
            }}
          />

          <div className="relative z-10 space-y-14 md:space-y-20">
            <ZigRow step={STEPS[0]} index={0} reverse={false} />
            <ZigRow step={STEPS[1]} index={1} reverse={true} />
            <ZigRow step={STEPS[2]} index={2} reverse={false} />
          </div>
        </div>
      </div>
    </section>
  );
}
