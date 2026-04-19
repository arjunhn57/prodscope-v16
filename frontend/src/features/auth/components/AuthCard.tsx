import { motion, useReducedMotion } from "framer-motion";
import { EDITORIAL_EASE, REPORT_GRADIENTS } from "../../report/tokens";

interface AuthCardProps {
  children: React.ReactNode;
}

export function AuthCard({ children }: AuthCardProps) {
  const reduceMotion = useReducedMotion();

  return (
    <motion.div
      initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 12, scale: 0.98 }}
      animate={reduceMotion ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.5, ease: EDITORIAL_EASE }}
      className="relative w-full max-w-[440px] px-8 py-9 md:px-10 md:py-10 rounded-[24px]"
      style={{
        background: REPORT_GRADIENTS.auroraTile,
        border: "1px solid rgba(108,71,255,0.22)",
        boxShadow:
          "0 2px 6px rgba(15,23,42,0.06), 0 20px 48px -20px rgba(15,23,42,0.14)",
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
      }}
    >
      {children}
    </motion.div>
  );
}
