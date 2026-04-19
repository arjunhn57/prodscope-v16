import { AnimatePresence, motion } from "framer-motion";

interface PhoneMockupProps {
  activeScreen: number;
  screens: ScreenData[];
  size?: "sm" | "md";
}

export interface ScreenData {
  name: string;
  image: string;
}

const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];

export function PhoneMockup({ activeScreen, screens, size = "md" }: PhoneMockupProps) {
  const current = screens[activeScreen];
  if (!current) return null;

  const widthClass =
    size === "sm" ? "w-[200px] md:w-[220px]" : "w-[260px] md:w-[280px]";

  return (
    <div className={`${widthClass} shrink-0`}>
      {/* Phone frame */}
      <div className="relative rounded-[28px] border-[3px] border-stone-800 bg-stone-900 p-1.5 shadow-[0_24px_64px_rgba(0,0,0,0.12)]">
        {/* Notch */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-24 h-5 bg-stone-800 rounded-b-2xl z-20" />

        {/* Screen area */}
        <div className="relative rounded-[20px] overflow-hidden bg-white aspect-[9/19.5]">
          {/* Seed frame — always-visible fallback so the frame is never empty */}
          <img
            src={screens[0].image}
            alt=""
            aria-hidden="true"
            className="absolute inset-0 w-full h-full object-cover"
            draggable={false}
            loading="eager"
            fetchPriority="high"
          />
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={current.name}
              initial={{ opacity: 0, scale: 0.97 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 1.02 }}
              transition={{ duration: 0.4, ease: EASE }}
              className="absolute inset-0"
            >
              <img
                src={current.image}
                alt={current.name}
                className="w-full h-full object-cover"
                draggable={false}
                loading="eager"
              />
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Home indicator */}
        <div className="flex justify-center pt-1.5">
          <div className="w-20 h-1 rounded-full bg-stone-600" />
        </div>
      </div>
    </div>
  );
}
