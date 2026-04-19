import { useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { useCountUp } from "react-countup";
import { ShaderBackground } from "@/components/ui/shader-background";

const HEADLINE_GRADIENT =
  "linear-gradient(120deg, #1E1B4B 0%, #4C1D95 32%, #6C47FF 58%, #DB2777 100%)";

const EASE_OUT: [number, number, number, number] = [0.22, 0.61, 0.36, 1];

interface CountUpSpanProps {
  end: number;
  prefix?: string;
  suffix?: string;
  delayMs: number;
  triggered: boolean;
  reduceMotion: boolean;
  duration?: number;
  className?: string;
  style?: React.CSSProperties;
}

function CountUpSpan({
  end,
  prefix,
  suffix,
  delayMs,
  triggered,
  reduceMotion,
  duration = 1.8,
  className,
  style,
}: CountUpSpanProps) {
  const spanRef = useRef<HTMLSpanElement>(null);

  const { start } = useCountUp({
    ref: spanRef as unknown as React.RefObject<HTMLElement>,
    start: 0,
    end,
    duration,
    delay: 0.25 + delayMs / 1000,
    prefix: prefix ?? "",
    suffix: suffix ?? "",
    useEasing: true,
    startOnMount: false,
  });

  useEffect(() => {
    if (!triggered) return;
    if (reduceMotion) {
      if (spanRef.current) {
        spanRef.current.textContent = `${prefix ?? ""}${end}${suffix ?? ""}`;
      }
      return;
    }
    start();
  }, [triggered, reduceMotion, end, prefix, suffix, start]);

  return (
    <span ref={spanRef} aria-live="off" className={className} style={style}>
      {prefix ?? ""}0{suffix ?? ""}
    </span>
  );
}

interface SupportingMetric {
  end: number;
  suffix: string;
  label: string;
  delayMs: number;
}

const SUPPORTING: readonly SupportingMetric[] = [
  { end: 500, suffix: "+", label: "Apps analyzed", delayMs: 120 },
  { end: 95, suffix: "%", label: "Coverage average", delayMs: 240 },
  { end: 4, suffix: " min", label: "Avg report time", delayMs: 360 },
] as const;

export function MetricsStrip() {
  const sectionRef = useRef<HTMLElement>(null);
  const [triggered, setTriggered] = useState(false);
  const [shaderVisible, setShaderVisible] = useState(false);
  const reduceMotion = useReducedMotion() ?? false;

  useEffect(() => {
    const el = sectionRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          setShaderVisible(entry.isIntersecting);
          if (entry.isIntersecting) {
            setTriggered(true);
          }
        }
      },
      { threshold: 0.2 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <section
      ref={sectionRef}
      id="metrics"
      role="region"
      aria-label="Key metrics"
      className="relative w-full overflow-hidden py-16 lg:py-20"
      style={{
        background: "var(--color-bg-secondary)",
      }}
    >
      {/* Shader squiggle background */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          opacity: 0.28,
          mixBlendMode: "multiply",
          zIndex: 1,
        }}
      >
        {shaderVisible && <ShaderBackground lineColor={[0.58, 0.56, 0.65]} />}
      </div>

      {/* Corner glow orbs */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 overflow-hidden"
        style={{ zIndex: 2 }}
      >
        <div
          className="absolute top-[-30%] left-[-10%] w-[40%] h-[80%] rounded-full blur-[140px]"
          style={{ background: "var(--color-accent)", opacity: 0.08 }}
        />
        <div
          className="absolute bottom-[-30%] right-[-10%] w-[40%] h-[80%] rounded-full blur-[160px]"
          style={{ background: "var(--color-accent-decorative)", opacity: 0.06 }}
        />
      </div>

      <div className="relative z-10 mx-auto max-w-[1200px] px-6">
        <motion.div
          initial={reduceMotion ? false : { opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-15% 0px" }}
          transition={{ duration: 0.5, ease: EASE_OUT }}
          className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center"
        >
          {/* Hero metric — 12K+ */}
          <motion.div
            initial={reduceMotion ? false : { opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-15% 0px" }}
            transition={{
              type: "spring",
              stiffness: 120,
              damping: 22,
            }}
            className="lg:col-span-6 text-center lg:text-left"
          >
            <span
              className="inline-flex items-center gap-2 mb-4 px-3 py-1 rounded-full"
              style={{
                background: "rgba(108, 71, 255, 0.08)",
                border: "1px solid rgba(108, 71, 255, 0.14)",
                color: "var(--color-accent)",
                fontFamily: "var(--font-label)",
                fontSize: "11px",
                fontWeight: 500,
                letterSpacing: "0.18em",
                textTransform: "uppercase",
              }}
            >
              <span
                className="w-1.5 h-1.5 rounded-full"
                style={{ background: "var(--color-accent)" }}
              />
              At scale
            </span>
            <div
              className="font-bold bg-clip-text text-transparent"
              style={{
                fontFamily: "var(--font-sans)",
                fontSize: "clamp(60px, 8vw, 104px)",
                fontWeight: 700,
                letterSpacing: "-0.04em",
                lineHeight: 0.95,
                backgroundImage: HEADLINE_GRADIENT,
                WebkitBackgroundClip: "text",
              }}
            >
              <CountUpSpan
                end={12}
                suffix="K+"
                delayMs={0}
                duration={2.1}
                triggered={triggered}
                reduceMotion={reduceMotion}
              />
            </div>
            <p
              className="mt-4 uppercase"
              style={{
                fontFamily: "var(--font-label)",
                fontSize: "13px",
                fontWeight: 500,
                letterSpacing: "0.12em",
                color: "rgba(15, 23, 42, 0.55)",
              }}
            >
              Screens discovered
            </p>
            <p
              className="mt-2 max-w-[420px] mx-auto lg:mx-0"
              style={{
                fontFamily: "var(--font-sans)",
                fontSize: "14px",
                lineHeight: 1.5,
                color: "rgba(15, 23, 42, 0.62)",
              }}
            >
              Across 500+ Android apps — coverage that compounds every week.
            </p>
          </motion.div>

          {/* Vertical hairline divider (desktop only) */}
          <div
            aria-hidden="true"
            className="hidden lg:flex lg:col-span-1 justify-center"
          >
            <div
              className="w-px h-[160px]"
              style={{
                background:
                  "linear-gradient(180deg, transparent 0%, rgba(15, 23, 42, 0.12) 30%, rgba(15, 23, 42, 0.12) 70%, transparent 100%)",
              }}
            />
          </div>

          {/* Supporting metrics */}
          <motion.div
            variants={{
              hidden: {},
              show: {
                transition: { staggerChildren: 0.1, delayChildren: 0.15 },
              },
            }}
            initial={reduceMotion ? undefined : "hidden"}
            whileInView={reduceMotion ? undefined : "show"}
            viewport={{ once: true, margin: "-15% 0px" }}
            className="lg:col-span-5 grid grid-cols-3 gap-4 lg:gap-5"
          >
            {SUPPORTING.map((metric, idx) => (
              <motion.div
                key={metric.label}
                variants={{
                  hidden: { opacity: 0, y: 12 },
                  show: { opacity: 1, y: 0 },
                }}
                transition={{ duration: 0.4, ease: EASE_OUT }}
                className="relative text-center lg:text-left px-4 py-5 lg:px-5 lg:py-6 rounded-xl"
                style={{
                  background:
                    "linear-gradient(170deg, rgba(255, 255, 255, 0.92), rgba(248, 250, 255, 0.70))",
                  boxShadow:
                    "0 18px 44px -10px rgba(51, 65, 85, 0.10), 0 2px 6px rgba(15, 23, 42, 0.06), inset 0 1px 0 rgba(255, 255, 255, 0.95), inset 0 0 0 1px rgba(148, 163, 184, 0.06)",
                  border: "1px solid rgba(71, 85, 105, 0.10)",
                  backdropFilter: "blur(10px)",
                }}
              >
                <motion.div
                  aria-hidden="true"
                  className="absolute inset-[10px] rounded-lg pointer-events-none"
                  style={{
                    background:
                      "radial-gradient(circle at 80% 20%, rgba(108, 71, 255, 0.09), transparent 60%)",
                  }}
                  animate={reduceMotion ? undefined : { y: [0, -3, 0] }}
                  transition={{
                    duration: 6.4,
                    repeat: Infinity,
                    ease: "easeInOut",
                    delay: idx * 0.8,
                  }}
                />
                <div className="relative">
                  <CountUpSpan
                    end={metric.end}
                    suffix={metric.suffix}
                    delayMs={metric.delayMs}
                    duration={1.6}
                    triggered={triggered}
                    reduceMotion={reduceMotion}
                    className="block font-bold"
                    style={{
                      fontFamily: "var(--font-sans)",
                      fontSize: "clamp(26px, 2.8vw, 38px)",
                      letterSpacing: "-0.03em",
                      lineHeight: 1,
                      color: "var(--color-accent)",
                    }}
                  />
                  <p
                    className="uppercase mt-3"
                    style={{
                      fontFamily: "var(--font-label)",
                      fontSize: "11px",
                      fontWeight: 500,
                      letterSpacing: "0.1em",
                      color: "rgba(15, 23, 42, 0.55)",
                    }}
                  >
                    {metric.label}
                  </p>
                </div>
              </motion.div>
            ))}
          </motion.div>
        </motion.div>
      </div>
    </section>
  );
}
