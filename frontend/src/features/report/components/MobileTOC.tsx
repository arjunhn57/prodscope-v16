import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { List, X } from "lucide-react";
import { EDITORIAL_EASE, REPORT_GRADIENTS, REPORT_SURFACES } from "../tokens";
import { TOC_ENTRIES, useActiveSection } from "./SideRailTOC";

/**
 * Mobile / tablet TOC — floating pill at bottom-right that opens a bottom sheet
 * listing every section. Hidden at `lg:` and above where the sticky left rail
 * is present.
 */
export function MobileTOC() {
  const [open, setOpen] = useState(false);
  const active = useActiveSection();
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const activeLabel =
    TOC_ENTRIES.find((e) => e.id === active)?.label ?? TOC_ENTRIES[0].label;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`Open report table of contents, currently viewing ${activeLabel}`}
        className="lg:hidden fixed bottom-5 right-4 z-30 inline-flex items-center gap-2 px-4 py-2.5 rounded-full text-[13px] font-semibold text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-report-accent-ring)] transition-transform active:scale-[0.97]"
        style={{
          background: REPORT_GRADIENTS.hero,
          boxShadow:
            "0 12px 28px -12px rgba(108,71,255,0.55), 0 4px 12px -4px rgba(15,23,42,0.2)",
          fontFamily: "var(--font-sans)",
        }}
      >
        <List className="w-4 h-4" aria-hidden="true" />
        <span className="truncate max-w-[160px]">{activeLabel}</span>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            key="mobile-toc-backdrop"
            className="lg:hidden fixed inset-0 z-40 bg-[rgba(15,23,42,0.45)] backdrop-blur-[2px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={() => setOpen(false)}
          >
            <motion.div
              key="mobile-toc-sheet"
              role="dialog"
              aria-modal="true"
              aria-label="Report table of contents"
              className="absolute inset-x-0 bottom-0 rounded-t-[28px] bg-white flex flex-col"
              style={{
                maxHeight: "80vh",
                boxShadow: REPORT_SURFACES.shadowLift,
                paddingBottom: "env(safe-area-inset-bottom)",
              }}
              initial={reduceMotion ? { opacity: 0 } : { y: "100%" }}
              animate={reduceMotion ? { opacity: 1 } : { y: 0 }}
              exit={reduceMotion ? { opacity: 0 } : { y: "100%" }}
              transition={{ type: "spring", damping: 32, stiffness: 320 }}
              onClick={(e) => e.stopPropagation()}
            >
              <div
                aria-hidden="true"
                className="mx-auto mt-2.5 w-10 h-1 rounded-full bg-[#E2E8F0]"
              />

              <div className="flex items-center justify-between px-5 pt-3 pb-2">
                <div
                  className="text-[10.5px] font-semibold uppercase tracking-[0.22em] text-[var(--color-text-muted)]"
                  style={{ fontFamily: "var(--font-label)" }}
                >
                  On this page
                </div>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label="Close table of contents"
                  className="w-8 h-8 rounded-full flex items-center justify-center text-[var(--color-text-muted)] hover:bg-[rgba(15,23,42,0.05)] hover:text-[var(--color-text-primary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-report-accent-ring)]"
                >
                  <X className="w-4 h-4" aria-hidden="true" />
                </button>
              </div>

              <nav
                aria-label="Report sections"
                className="px-3 pb-5 overflow-y-auto"
              >
                <ul className="flex flex-col">
                  {TOC_ENTRIES.map((e) => {
                    const isActive = active === e.id;
                    return (
                      <li key={e.id}>
                        <a
                          href={`#${e.id}`}
                          onClick={() => setOpen(false)}
                          className={`flex items-center gap-3 px-3 py-3 rounded-xl text-[14px] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-report-accent-ring)] ${
                            isActive
                              ? "bg-[rgba(108,71,255,0.08)] text-[var(--color-text-primary)] font-semibold"
                              : "text-[var(--color-text-secondary)] hover:bg-[rgba(15,23,42,0.04)]"
                          }`}
                          style={{
                            fontFamily: "var(--font-sans)",
                            transition: `background-color 0.18s ${EDITORIAL_EASE}`,
                          }}
                        >
                          <span
                            aria-hidden
                            className={`inline-block h-[3px] rounded-full transition-all ${
                              isActive
                                ? "w-6 bg-[var(--color-report-accent)]"
                                : "w-3 bg-[#CBD5E1]"
                            }`}
                          />
                          {e.label}
                        </a>
                      </li>
                    );
                  })}
                </ul>
              </nav>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
