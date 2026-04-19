import { useRef } from "react";
import { motion, useReducedMotion, useInView } from "framer-motion";
import { AnimatedCounter } from "@/components/shared/AnimatedCounter";

const EASE_OUT_QUINT: [number, number, number, number] = [0.22, 1, 0.36, 1];

interface Metric {
  value: number;
  suffix: string;
  label: string;
}

const METRICS: Metric[] = [
  { value: 47, suffix: "K+", label: "Screens explored" },
  { value: 12, suffix: "K+", label: "Findings reported" },
  { value: 500, suffix: "+", label: "Apps analyzed" },
];

export function MetricsRow() {
  const ref = useRef<HTMLDivElement>(null);
  const isInView = useInView(ref, { once: true, margin: "-80px" });
  const prefersReducedMotion = useReducedMotion();

  return (
    <section className="py-20 md:py-28 bg-bg-primary">
      <div ref={ref} className="mx-auto max-w-[1120px] px-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-12 md:gap-8">
          {METRICS.map((metric, i) => (
            <motion.div
              key={metric.label}
              initial={prefersReducedMotion ? {} : { opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{
                duration: 0.5,
                delay: i * 0.12,
                ease: EASE_OUT_QUINT,
              }}
              className="text-center"
            >
              <div className="text-[56px] md:text-[64px] font-bold text-text-primary tracking-tight leading-none">
                {isInView ? (
                  <AnimatedCounter
                    value={metric.value}
                    suffix={metric.suffix}
                  />
                ) : (
                  <span>0{metric.suffix}</span>
                )}
              </div>
              <p className="text-sm text-text-muted mt-2 font-medium tracking-wide uppercase">
                {metric.label}
              </p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
