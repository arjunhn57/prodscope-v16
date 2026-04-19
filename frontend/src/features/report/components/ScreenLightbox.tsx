import { useEffect, useRef } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { X, ChevronLeft, ChevronRight } from "lucide-react";
import { EDITORIAL_EASE } from "../tokens";
import { Picture } from "@/components/ui/Picture";

export interface LightboxScreen {
  path: string | null;
  label: string;
  caption?: string;
  step?: number;
}

interface ScreenLightboxProps {
  open: boolean;
  screens: LightboxScreen[];
  index: number;
  onClose: () => void;
  onNavigate: (nextIndex: number) => void;
}

export function ScreenLightbox({
  open,
  screens,
  index,
  onClose,
  onNavigate,
}: ScreenLightboxProps) {
  const reduceMotion = useReducedMotion();
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const current = screens[index];

  useEffect(() => {
    if (!open) return;
    previousFocus.current = document.activeElement as HTMLElement | null;
    closeButtonRef.current?.focus();

    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === "ArrowRight" && index < screens.length - 1) {
        e.preventDefault();
        onNavigate(index + 1);
        return;
      }
      if (e.key === "ArrowLeft" && index > 0) {
        e.preventDefault();
        onNavigate(index - 1);
        return;
      }
      if (e.key === "Tab") {
        e.preventDefault();
        closeButtonRef.current?.focus();
      }
    };

    document.addEventListener("keydown", handleKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", handleKey);
      document.body.style.overflow = prevOverflow;
      previousFocus.current?.focus();
    };
  }, [open, index, screens.length, onClose, onNavigate]);

  return (
    <AnimatePresence>
      {open && current && (
        <motion.div
          role="dialog"
          aria-modal="true"
          aria-label={current.label}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reduceMotion ? 0 : 0.22, ease: EDITORIAL_EASE }}
          className="fixed inset-0 z-[200] flex items-center justify-center bg-[rgba(15,23,42,0.72)] backdrop-blur-sm px-4 py-8"
          onClick={onClose}
        >
          <button
            ref={closeButtonRef}
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="absolute top-4 right-4 w-10 h-10 rounded-full bg-white shadow flex items-center justify-center text-[var(--color-text-primary)] hover:bg-[#F8FAFC] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent-ring)]"
          >
            <X className="w-4 h-4" />
          </button>

          {index > 0 && (
            <button
              type="button"
              aria-label="Previous screen"
              onClick={(e) => {
                e.stopPropagation();
                onNavigate(index - 1);
              }}
              className="absolute left-3 md:left-6 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white shadow flex items-center justify-center focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent-ring)]"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
          )}
          {index < screens.length - 1 && (
            <button
              type="button"
              aria-label="Next screen"
              onClick={(e) => {
                e.stopPropagation();
                onNavigate(index + 1);
              }}
              className="absolute right-3 md:right-6 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white shadow flex items-center justify-center focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent-ring)]"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          )}

          <motion.div
            onClick={(e) => e.stopPropagation()}
            initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 12, scale: 0.98 }}
            animate={reduceMotion ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 12, scale: 0.98 }}
            transition={{ duration: reduceMotion ? 0 : 0.28, ease: EDITORIAL_EASE }}
            className="relative flex flex-col items-center gap-4 max-w-[min(92vw,420px)] w-full"
          >
            <div className="w-full rounded-2xl overflow-hidden bg-white shadow-xl">
              <div className="aspect-[9/19] bg-[#F1F5F9] flex items-center justify-center">
                {current.path ? (
                  <Picture
                    src={current.path}
                    alt={current.label}
                    priority
                    width={400}
                    height={866}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="text-[12px] text-[var(--color-text-muted)]">
                    Screenshot unavailable
                  </div>
                )}
              </div>
            </div>
            <div className="text-center text-white">
              <div className="text-[13px] font-semibold">{current.label}</div>
              {current.caption && (
                <div className="mt-1 text-[11.5px] text-white/70">{current.caption}</div>
              )}
              <div className="mt-2 text-[10.5px] text-white/60 tabular-nums">
                {index + 1} / {screens.length}
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
