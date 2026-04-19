import { motion, useMotionValue, useSpring, useTransform } from "framer-motion";
import type { ReactNode, MouseEvent } from "react";

interface FeatureCardProps {
  icon: ReactNode;
  title: string;
  description: string;
  index: number;
}

export function FeatureCard({ icon, title, description, index }: FeatureCardProps) {
  const x = useMotionValue(0);
  const y = useMotionValue(0);

  const rotateX = useSpring(useTransform(y, [-120, 120], [6, -6]), { stiffness: 300, damping: 30 });
  const rotateY = useSpring(useTransform(x, [-120, 120], [-6, 6]), { stiffness: 300, damping: 30 });

  function handleMouse(e: MouseEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    x.set(e.clientX - rect.left - rect.width / 2);
    y.set(e.clientY - rect.top - rect.height / 2);
  }

  function handleLeave() {
    x.set(0);
    y.set(0);
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-60px" }}
      transition={{ duration: 0.5, delay: index * 0.1, ease: [0.22, 1, 0.36, 1] }}
      onMouseMove={handleMouse}
      onMouseLeave={handleLeave}
      style={{
        rotateX,
        rotateY,
        transformStyle: "preserve-3d",
        perspective: 800,
      }}
      className="group"
    >
      <div className="surface-card p-8 h-full transition-shadow duration-300 group-hover:shadow-[0_12px_32px_rgba(0,0,0,0.06)]">
        <div
          className="w-12 h-12 rounded-xl bg-accent-glow flex items-center justify-center text-accent mb-5"
          style={{ transform: "translateZ(16px)" }}
        >
          {icon}
        </div>
        <h3
          className="text-lg font-semibold text-text-primary mb-2 tracking-tight"
          style={{ transform: "translateZ(10px)" }}
        >
          {title}
        </h3>
        <p className="text-sm text-text-secondary leading-relaxed">{description}</p>
      </div>
    </motion.div>
  );
}
