import { useEffect, useState } from "react";
import { SECTION_IDS, type SectionId } from "../tokens";

export interface TOCEntry {
  id: SectionId;
  label: string;
}

export const TOC_ENTRIES: TOCEntry[] = [
  { id: SECTION_IDS.verdict, label: "Verdict" },
  { id: SECTION_IDS.signals, label: "Signal Cluster" },
  { id: SECTION_IDS.summary, label: "Executive Summary" },
  { id: SECTION_IDS.keyNumbers, label: "Key Numbers" },
  { id: SECTION_IDS.strengths, label: "Strengths" },
  { id: SECTION_IDS.findings, label: "Findings" },
  { id: SECTION_IDS.atlas, label: "Screen Atlas" },
  { id: SECTION_IDS.coverage, label: "Coverage" },
  { id: SECTION_IDS.journey, label: "Journey Map" },
  { id: SECTION_IDS.timeline, label: "Decision Timeline" },
  { id: SECTION_IDS.recommendations, label: "Recommendations" },
  { id: SECTION_IDS.footer, label: "Export" },
];

export function useActiveSection(): string {
  const [active, setActive] = useState<string>(TOC_ENTRIES[0].id);

  useEffect(() => {
    const observed: HTMLElement[] = [];
    for (const e of TOC_ENTRIES) {
      const el = document.getElementById(e.id);
      if (el) observed.push(el);
    }
    if (observed.length === 0) return;

    const visible = new Map<string, number>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            visible.set(entry.target.id, entry.intersectionRatio);
          } else {
            visible.delete(entry.target.id);
          }
        }

        let bestId: string | null = null;
        let bestRatio = -1;
        for (const [id, ratio] of visible.entries()) {
          if (ratio > bestRatio) {
            bestId = id;
            bestRatio = ratio;
          }
        }
        if (bestId) setActive(bestId);
      },
      {
        rootMargin: "-20% 0px -60% 0px",
        threshold: [0, 0.25, 0.5, 0.75, 1],
      }
    );

    for (const el of observed) observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return active;
}

export function SideRailTOC() {
  const active = useActiveSection();

  return (
    <nav
      aria-label="Report sections"
      className="hidden lg:block sticky top-24 max-h-[calc(100vh-6rem)] overflow-y-auto pr-2"
    >
      <div
        className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--color-text-muted)] mb-3"
        style={{ fontFamily: "var(--font-label)" }}
      >
        On this page
      </div>
      <ul className="flex flex-col gap-1.5">
        {TOC_ENTRIES.map((e) => {
          const isActive = active === e.id;
          return (
            <li key={e.id}>
              <a
                href={`#${e.id}`}
                className={`group flex items-center gap-2.5 py-1.5 text-[12.5px] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent-ring)] rounded ${
                  isActive
                    ? "text-[var(--color-text-primary)] font-semibold"
                    : "text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]"
                }`}
              >
                <span
                  aria-hidden
                  className={`inline-block h-[2px] rounded-full transition-all ${
                    isActive ? "w-6 bg-[var(--color-accent)]" : "w-3 bg-[#CBD5E1] group-hover:w-4 group-hover:bg-[#94A3B8]"
                  }`}
                />
                {e.label}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
