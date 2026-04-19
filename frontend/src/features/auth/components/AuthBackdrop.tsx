import { motion, useReducedMotion } from "framer-motion";

const PAGE_BG = [
  "radial-gradient(80% 50% at 50% 0%, rgba(108,71,255,0.08) 0%, rgba(108,71,255,0) 55%)",
  "radial-gradient(60% 50% at 50% 0%, rgba(219,39,119,0.05) 0%, rgba(219,39,119,0) 60%)",
  "#FAFAFA",
].join(", ");

const ORB_GRADIENT =
  "radial-gradient(50% 50% at 50% 50%, rgba(138,108,255,0.28) 0%, rgba(138,108,255,0.12) 38%, rgba(219,39,119,0.08) 62%, rgba(219,39,119,0) 78%)";

export function AuthBackdrop() {
  const reduceMotion = useReducedMotion();

  return (
    <div
      aria-hidden
      className="absolute inset-0 overflow-hidden pointer-events-none"
      style={{ background: PAGE_BG }}
    >
      <motion.div
        className="absolute top-[10%] left-1/2 -translate-x-1/2"
        style={{ width: 720, height: 720, filter: "blur(48px)" }}
        animate={
          reduceMotion
            ? {}
            : {
                rotate: [0, 360],
              }
        }
        transition={
          reduceMotion
            ? { duration: 0 }
            : { duration: 40, ease: "linear", repeat: Infinity }
        }
      >
        <motion.div
          className="w-full h-full rounded-full"
          style={{ background: ORB_GRADIENT }}
          animate={
            reduceMotion
              ? {}
              : {
                  scale: [1, 1.08, 1],
                  opacity: [0.85, 1, 0.85],
                }
          }
          transition={
            reduceMotion
              ? { duration: 0 }
              : { duration: 8, ease: "easeInOut", repeat: Infinity }
          }
        />
      </motion.div>
    </div>
  );
}
