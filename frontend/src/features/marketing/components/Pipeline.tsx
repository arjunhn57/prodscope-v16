import { useRef } from "react";
import {
  motion,
  useScroll,
  useTransform,
  useReducedMotion,
} from "framer-motion";
import { Upload, Cpu, FileCheck } from "lucide-react";

const EASE_OUT_QUINT: [number, number, number, number] = [0.22, 1, 0.36, 1];

interface Stage {
  number: string;
  title: string;
  description: string;
  icon: React.ReactNode;
}

const STAGES: Stage[] = [
  {
    number: "01",
    title: "Upload",
    description: "Drop your APK. Nothing else needed.",
    icon: <Upload className="w-6 h-6" />,
  },
  {
    number: "02",
    title: "Analyze",
    description: "AI explores every screen on a real device.",
    icon: <Cpu className="w-6 h-6" />,
  },
  {
    number: "03",
    title: "Report",
    description: "Get findings, coverage, and an analysis score.",
    icon: <FileCheck className="w-6 h-6" />,
  },
];

export function Pipeline() {
  const sectionRef = useRef<HTMLDivElement>(null);
  const prefersReducedMotion = useReducedMotion();
  const { scrollYProgress } = useScroll({
    target: sectionRef,
    offset: ["start end", "end start"],
  });

  const lineHeight = useTransform(scrollYProgress, [0.1, 0.7], ["0%", "100%"]);

  return (
    <section
      id="how-it-works"
      ref={sectionRef}
      className="py-24 md:py-32 bg-bg-tertiary"
    >
      <div className="mx-auto max-w-[1120px] px-6">
        {/* Header */}
        <motion.div
          initial={prefersReducedMotion ? {} : { opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5, ease: EASE_OUT_QUINT }}
          className="text-center mb-20"
        >
          <span className="text-xs font-medium text-text-muted tracking-[0.1em] uppercase">
            How It Works
          </span>
          <h2 className="text-3xl md:text-[44px] font-semibold text-text-primary tracking-tight mt-3 leading-[1.15]">
            Three steps. Zero setup.
          </h2>
        </motion.div>

        {/* Stages */}
        <div className="relative max-w-2xl mx-auto">
          {/* Connecting line */}
          <div className="absolute left-8 md:left-12 top-0 bottom-0 w-px bg-border-default">
            <motion.div
              className="w-full bg-accent origin-top"
              style={{ height: lineHeight }}
            />
          </div>

          <div className="space-y-16 md:space-y-20">
            {STAGES.map((stage, i) => (
              <motion.div
                key={stage.number}
                initial={prefersReducedMotion ? {} : { opacity: 0, x: -24 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true, margin: "-60px" }}
                transition={{
                  duration: 0.6,
                  delay: i * 0.15,
                  ease: EASE_OUT_QUINT,
                }}
                className="relative flex items-start gap-8 md:gap-12"
              >
                {/* Stage number */}
                <div className="relative z-10 shrink-0 w-16 h-16 md:w-24 md:h-24 rounded-2xl bg-bg-secondary border border-border-default flex items-center justify-center">
                  <span className="text-2xl md:text-4xl font-bold text-accent/20">
                    {stage.number}
                  </span>
                </div>

                {/* Content */}
                <div className="pt-2 md:pt-4">
                  <div className="flex items-center gap-3 mb-2">
                    <div className="text-accent">{stage.icon}</div>
                    <h3 className="text-xl md:text-2xl font-semibold text-text-primary tracking-tight">
                      {stage.title}
                    </h3>
                  </div>
                  <p className="text-base text-text-secondary leading-relaxed">
                    {stage.description}
                  </p>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
