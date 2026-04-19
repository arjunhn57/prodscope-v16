import { motion, useMotionValue, useSpring, useTransform } from "framer-motion";
import type { MouseEvent, ReactNode } from "react";

interface AuroraHeroProps {
  children: ReactNode;
}

export function AuroraHero({ children }: AuroraHeroProps) {
  const mouseX = useMotionValue(0.5);
  const mouseY = useMotionValue(0.5);

  const springX = useSpring(mouseX, { stiffness: 50, damping: 30 });
  const springY = useSpring(mouseY, { stiffness: 50, damping: 30 });

  // Orb 1 — large primary blue
  const orb1X = useTransform(springX, [0, 1], ["20%", "60%"]);
  const orb1Y = useTransform(springY, [0, 1], ["10%", "50%"]);

  // Orb 2 — smaller sky blue
  const orb2X = useTransform(springX, [0, 1], ["55%", "30%"]);
  const orb2Y = useTransform(springY, [0, 1], ["50%", "15%"]);

  // Orb 3 — subtle teal
  const orb3X = useTransform(springX, [0, 1], ["70%", "45%"]);
  const orb3Y = useTransform(springY, [0, 1], ["20%", "60%"]);

  function handleMouseMove(e: MouseEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    mouseX.set((e.clientX - rect.left) / rect.width);
    mouseY.set((e.clientY - rect.top) / rect.height);
  }

  return (
    <div
      onMouseMove={handleMouseMove}
      className="relative min-h-dvh flex items-center justify-center overflow-hidden bg-bg-primary"
    >
      {/* Aurora orbs */}
      <div className="absolute inset-0 pointer-events-none">
        <motion.div
          style={{ left: orb1X, top: orb1Y }}
          className="absolute w-[600px] h-[600px] -translate-x-1/2 -translate-y-1/2 rounded-full opacity-[0.07]"
          initial={{ scale: 0.8 }}
          animate={{ scale: [0.8, 1.1, 0.8] }}
          transition={{ duration: 8, repeat: Infinity, ease: "easeInOut" }}
        >
          <div className="w-full h-full rounded-full bg-[radial-gradient(circle,#0369A1_0%,transparent_70%)]" />
        </motion.div>

        <motion.div
          style={{ left: orb2X, top: orb2Y }}
          className="absolute w-[400px] h-[400px] -translate-x-1/2 -translate-y-1/2 rounded-full opacity-[0.05]"
          initial={{ scale: 1 }}
          animate={{ scale: [1, 0.85, 1] }}
          transition={{ duration: 6, repeat: Infinity, ease: "easeInOut", delay: 1 }}
        >
          <div className="w-full h-full rounded-full bg-[radial-gradient(circle,#0EA5E9_0%,transparent_70%)]" />
        </motion.div>

        <motion.div
          style={{ left: orb3X, top: orb3Y }}
          className="absolute w-[350px] h-[350px] -translate-x-1/2 -translate-y-1/2 rounded-full opacity-[0.04]"
          initial={{ scale: 0.9 }}
          animate={{ scale: [0.9, 1.15, 0.9] }}
          transition={{ duration: 10, repeat: Infinity, ease: "easeInOut", delay: 2 }}
        >
          <div className="w-full h-full rounded-full bg-[radial-gradient(circle,#14B8A6_0%,transparent_70%)]" />
        </motion.div>

        {/* Grain overlay */}
        <div
          className="absolute inset-0 opacity-[0.025]"
          style={{
            backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`,
          }}
        />
      </div>

      {/* Content */}
      <div className="relative z-10 w-full">{children}</div>
    </div>
  );
}
