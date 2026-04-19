import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { AlertTriangle } from "lucide-react";

interface ConnectionBannerProps {
  visible: boolean;
  retryAt: number | null;
  attempt: number;
}

export function ConnectionBanner({ visible, retryAt, attempt }: ConnectionBannerProps) {
  const reduceMotion = useReducedMotion();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!visible || !retryAt) return;
    const id = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(id);
  }, [visible, retryAt]);

  const remainingMs = retryAt ? Math.max(0, retryAt - now) : 0;
  const remainingSec = Math.ceil(remainingMs / 1000);
  const label =
    remainingSec > 0
      ? `Connection lost · retrying in ${remainingSec}s`
      : "Reconnecting…";

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          key="conn-banner"
          initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -8 }}
          animate={reduceMotion ? { opacity: 1 } : { opacity: 1, y: 0 }}
          exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -8 }}
          transition={{ duration: 0.22, ease: "easeOut" }}
          className="sticky top-16 z-30 px-4 md:px-6 lg:px-8 pt-2"
          role="status"
          aria-live="polite"
        >
          <div
            className="mx-auto flex items-center gap-2 px-3 py-1.5 rounded-full"
            style={{
              maxWidth: 1440,
              width: "fit-content",
              background: "rgba(245, 158, 11, 0.10)",
              border: "1px solid rgba(245, 158, 11, 0.35)",
              backdropFilter: "blur(12px)",
              WebkitBackdropFilter: "blur(12px)",
            }}
          >
            <AlertTriangle className="w-3.5 h-3.5" style={{ color: "#F59E0B" }} />
            <span
              className="text-[11px] tabular-nums"
              style={{
                fontFamily: "var(--font-mono)",
                color: "#FBBF24",
                letterSpacing: "0.02em",
              }}
              aria-label={`Connection lost, retrying (attempt ${attempt})`}
            >
              {label}
            </span>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
