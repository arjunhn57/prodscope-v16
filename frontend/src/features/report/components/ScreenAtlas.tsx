import { useMemo, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { ChevronDown } from "lucide-react";
import type { CrawlReport, ScreenRecord } from "../types";
import {
  REPORT_SURFACES,
  SECTION_IDS,
  EDITORIAL_EASE,
  SCREEN_TYPE_LABEL,
} from "../tokens";
import { clusterScreensByClassification } from "../useReportData";
import { ScreenLightbox, type LightboxScreen } from "./ScreenLightbox";
import { Picture } from "@/components/ui/Picture";

interface ScreenAtlasProps {
  report: CrawlReport;
}

interface Cluster {
  classifier: string;
  coverPath: string | null;
  screens: ScreenRecord[];
}

function Thumb({
  screen,
  onOpen,
  rounded = "rounded-xl",
}: {
  screen: ScreenRecord;
  onOpen: () => void;
  rounded?: string;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className={`group relative block w-full aspect-[9/16] overflow-hidden ${rounded} focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent-ring)]`}
      style={{
        background: "#F1F5F9",
        border: "1px solid #E2E8F0",
      }}
      aria-label={`Open screen ${screen.step}`}
    >
      {screen.path ? (
        <Picture
          src={screen.path}
          alt={`Screen ${screen.step} — ${screen.activity}`}
          width={180}
          height={390}
          className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center text-[10.5px] text-[var(--color-text-muted)]">
          No capture
        </div>
      )}
      <span
        className="absolute top-1.5 left-1.5 text-[9px] font-semibold uppercase tracking-[0.2em] px-1.5 py-0.5 rounded-full bg-white/90 text-[var(--color-text-secondary)]"
        style={{ fontFamily: "var(--font-label)" }}
      >
        {String(screen.step).padStart(2, "0")}
      </span>
    </button>
  );
}

export function ScreenAtlas({ report }: ScreenAtlasProps) {
  const reduceMotion = useReducedMotion();
  const clusters = useMemo<Cluster[]>(
    () => clusterScreensByClassification(report) as Cluster[],
    [report]
  );
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [lightbox, setLightbox] = useState<{
    open: boolean;
    screens: LightboxScreen[];
    index: number;
  }>({ open: false, screens: [], index: 0 });

  const toggle = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const openLightbox = (cluster: Cluster, idx: number) => {
    const screens: LightboxScreen[] = cluster.screens.map((s) => ({
      path: s.path,
      label: `${cluster.classifier} · step ${s.step}`,
      caption: s.activity,
      step: s.step,
    }));
    setLightbox({ open: true, screens, index: idx });
  };

  return (
    <section
      id={SECTION_IDS.atlas}
      className="py-12 md:py-16 border-b border-[var(--color-border-subtle)]"
    >
      <motion.div
        initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 10 }}
        whileInView={reduceMotion ? { opacity: 1 } : { opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-60px" }}
        transition={{ duration: 0.5, ease: EDITORIAL_EASE }}
      >
        <div className="flex items-end justify-between gap-4 mb-6">
          <div>
            <div
              className="text-[10.5px] font-semibold uppercase tracking-[0.22em] text-[var(--color-text-muted)]"
              style={{ fontFamily: "var(--font-label)" }}
            >
              Screen Atlas
            </div>
            <h2
              className="mt-2 text-[28px] md:text-[34px] font-semibold text-[var(--color-text-primary)] leading-tight"
              style={{ fontFamily: "var(--font-heading)", letterSpacing: "-0.02em" }}
            >
              {report.screens.length} screens ·{" "}
              <span className="text-[var(--color-text-muted)]">
                {clusters.length} area{clusters.length === 1 ? "" : "s"}
              </span>
            </h2>
          </div>
        </div>

        {clusters.length === 0 ? (
          <div
            className="px-6 py-10 rounded-[20px] text-center text-[var(--color-text-muted)] text-[13px]"
            style={{
              background: "#F8FAFC",
              border: REPORT_SURFACES.borderDefault,
            }}
          >
            No screens were captured during this analysis.
          </div>
        ) : (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {clusters.map((cluster, i) => {
              const label =
                SCREEN_TYPE_LABEL[cluster.classifier] ?? cluster.classifier;
              const isOpen = expanded.has(cluster.classifier);
              const cover = cluster.screens[0];
              const tail = cluster.screens.slice(1, 4);
              const extras = Math.max(0, cluster.screens.length - 4);

              return (
                <motion.div
                  key={cluster.classifier}
                  initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 8 }}
                  whileInView={reduceMotion ? { opacity: 1 } : { opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{
                    duration: 0.4,
                    delay: reduceMotion ? 0 : 0.08 + i * 0.06,
                    ease: EDITORIAL_EASE,
                  }}
                  className="p-4 rounded-[20px] bg-white"
                  style={{
                    border: REPORT_SURFACES.borderDefault,
                    boxShadow: REPORT_SURFACES.shadowSoft,
                  }}
                >
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <span
                        className="text-[10.5px] font-semibold uppercase tracking-[0.2em] text-[var(--color-text-secondary)]"
                        style={{ fontFamily: "var(--font-label)" }}
                      >
                        {label}
                      </span>
                      <span
                        className="text-[10.5px] tabular-nums text-[var(--color-text-muted)] px-2 py-0.5 rounded-full"
                        style={{
                          background: "#F1F5F9",
                          border: "1px solid #E2E8F0",
                        }}
                      >
                        {cluster.screens.length}
                      </span>
                    </div>
                    {cluster.screens.length > 4 && (
                      <button
                        type="button"
                        onClick={() => toggle(cluster.classifier)}
                        className="inline-flex items-center gap-1 text-[11.5px] text-[var(--color-accent)] hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent-ring)] rounded"
                        aria-expanded={isOpen}
                      >
                        {isOpen ? "Collapse" : "Show all"}
                        <ChevronDown
                          className={`w-3.5 h-3.5 transition-transform ${
                            isOpen ? "rotate-180" : ""
                          }`}
                        />
                      </button>
                    )}
                  </div>

                  <div className="grid grid-cols-4 gap-2">
                    <div className="col-span-2 row-span-2">
                      <Thumb
                        screen={cover}
                        onOpen={() => openLightbox(cluster, 0)}
                        rounded="rounded-xl"
                      />
                    </div>
                    {tail.map((s, idx) => (
                      <div key={s.fuzzyFp + idx}>
                        <Thumb
                          screen={s}
                          onOpen={() => openLightbox(cluster, idx + 1)}
                          rounded="rounded-md"
                        />
                      </div>
                    ))}
                    {extras > 0 && !isOpen && (
                      <button
                        type="button"
                        onClick={() => toggle(cluster.classifier)}
                        className="aspect-[9/16] rounded-md flex items-center justify-center text-[12px] font-semibold text-[var(--color-text-secondary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent-ring)]"
                        style={{
                          background: "#F8FAFC",
                          border: "1px dashed #CBD5E1",
                        }}
                        aria-label={`Show ${extras} more`}
                      >
                        +{extras}
                      </button>
                    )}
                  </div>

                  {isOpen && cluster.screens.length > 4 && (
                    <div className="mt-3 grid grid-cols-4 gap-2">
                      {cluster.screens.slice(4).map((s, idx) => (
                        <Thumb
                          key={s.fuzzyFp + idx}
                          screen={s}
                          onOpen={() => openLightbox(cluster, idx + 4)}
                          rounded="rounded-md"
                        />
                      ))}
                    </div>
                  )}
                </motion.div>
              );
            })}
          </div>
        )}
      </motion.div>

      <ScreenLightbox
        open={lightbox.open}
        screens={lightbox.screens}
        index={lightbox.index}
        onClose={() => setLightbox((p) => ({ ...p, open: false }))}
        onNavigate={(next) => setLightbox((p) => ({ ...p, index: next }))}
      />
    </section>
  );
}
