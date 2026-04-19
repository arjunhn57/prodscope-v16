import { useEffect, useRef } from "react";
import { motion, useMotionValue, useSpring, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils";
import type { FC, SVGProps, ReactNode, MouseEvent } from "react";

interface IconConfig {
  id: number;
  icon: FC<SVGProps<SVGSVGElement>>;
  className: string;
}

function FloatingIcon({
  mouseX,
  mouseY,
  iconData,
  index,
}: {
  mouseX: React.MutableRefObject<number>;
  mouseY: React.MutableRefObject<number>;
  iconData: IconConfig;
  index: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const prefersReducedMotion = useReducedMotion();

  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const springX = useSpring(x, { stiffness: 200, damping: 25 });
  const springY = useSpring(y, { stiffness: 200, damping: 25 });

  useEffect(() => {
    if (prefersReducedMotion) return;

    function handleMouseMove() {
      if (!ref.current) return;
      const rect = ref.current.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const dist = Math.sqrt(
        (mouseX.current - cx) ** 2 + (mouseY.current - cy) ** 2
      );

      if (dist < 150) {
        const angle = Math.atan2(mouseY.current - cy, mouseX.current - cx);
        const force = (1 - dist / 150) * 40;
        x.set(-Math.cos(angle) * force);
        y.set(-Math.sin(angle) * force);
      } else {
        x.set(0);
        y.set(0);
      }
    }

    window.addEventListener("mousemove", handleMouseMove);
    return () => window.removeEventListener("mousemove", handleMouseMove);
  }, [x, y, mouseX, mouseY, prefersReducedMotion]);

  const IconComp = iconData.icon;

  return (
    <motion.div
      ref={ref}
      style={{ x: springX, y: springY }}
      initial={{ opacity: 0, scale: 0.5 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{
        delay: 0.8 + index * 0.08,
        duration: 0.6,
        ease: [0.22, 1, 0.36, 1],
      }}
      className={cn("absolute", iconData.className)}
    >
      <motion.div
        className="flex items-center justify-center w-12 h-12 md:w-14 md:h-14 rounded-2xl bg-white/80 backdrop-blur-sm border border-[#E2E8F0]/60 shadow-[0_1px_3px_rgba(0,0,0,0.04)]"
        animate={
          prefersReducedMotion
            ? {}
            : {
                y: [0, -6, 0, 6, 0],
                x: [0, 4, 0, -4, 0],
                rotate: [0, 3, 0, -3, 0],
              }
        }
        transition={{
          duration: 6 + Math.random() * 4,
          repeat: Infinity,
          repeatType: "mirror",
          ease: "easeInOut",
        }}
      >
        <IconComp className="w-5 h-5 md:w-6 md:h-6 text-text-muted" />
      </motion.div>
    </motion.div>
  );
}

interface FloatingIconsBackgroundProps {
  icons: IconConfig[];
  children: ReactNode;
  className?: string;
}

export function FloatingIconsBackground({
  icons,
  children,
  className,
}: FloatingIconsBackgroundProps) {
  const mouseX = useRef(0);
  const mouseY = useRef(0);

  function handleMouseMove(e: MouseEvent<HTMLDivElement>) {
    mouseX.current = e.clientX;
    mouseY.current = e.clientY;
  }

  return (
    <div
      onMouseMove={handleMouseMove}
      className={cn("relative overflow-hidden", className)}
    >
      {/* Floating icons layer */}
      <div className="absolute inset-0 pointer-events-none">
        {icons.map((iconData, index) => (
          <FloatingIcon
            key={iconData.id}
            mouseX={mouseX}
            mouseY={mouseY}
            iconData={iconData}
            index={index}
          />
        ))}
      </div>

      {/* Content layer */}
      <div className="relative z-10 w-full">{children}</div>
    </div>
  );
}
