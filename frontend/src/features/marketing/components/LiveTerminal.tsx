import { useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";

interface TerminalLine {
  text: string;
  type: "default" | "success" | "warning" | "info";
}

const CRAWL_LINES: TerminalLine[] = [
  { text: "$ prodscope analyze com.example.app", type: "info" },
  { text: "Installing APK on device...                    done", type: "success" },
  { text: "Launching MainActivity", type: "default" },
  { text: "Screen captured: LoginScreen", type: "default" },
  { text: "Found 4 interactive elements", type: "info" },
  { text: 'Tapping "Sign In" button...', type: "default" },
  { text: "Navigation detected \u2192 HomeScreen", type: "success" },
  { text: "Screen captured: HomeScreen", type: "default" },
  { text: "Found 12 interactive elements", type: "info" },
  { text: "\u26a0 Finding: Empty state missing for no-data view", type: "warning" },
  { text: "Exploring ProfileScreen...", type: "default" },
  { text: "Screen captured: ProfileScreen", type: "default" },
  { text: "\u26a0 Finding: Image alt text missing on avatar", type: "warning" },
  { text: "Navigation detected \u2192 SettingsScreen", type: "success" },
  { text: "Coverage: 8 screens mapped, 47 elements found", type: "info" },
  { text: "Generating analysis report...                  done", type: "success" },
  { text: "Score: 87/100  |  Findings: 6  |  Coverage: 92%", type: "info" },
];

const LINE_DELAY = 700;

const TYPE_COLORS: Record<TerminalLine["type"], string> = {
  default: "text-stone-400",
  success: "text-emerald-400",
  warning: "text-amber-400",
  info: "text-sky-400",
};

export function LiveTerminal() {
  const prefersReducedMotion = useReducedMotion();
  const [visibleCount, setVisibleCount] = useState(
    prefersReducedMotion ? CRAWL_LINES.length : 0
  );
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (prefersReducedMotion) return;

    const startDelay = setTimeout(() => {
      const interval = setInterval(() => {
        setVisibleCount((prev) => {
          if (prev >= CRAWL_LINES.length) {
            clearInterval(interval);
            return prev;
          }
          return prev + 1;
        });
      }, LINE_DELAY);

      return () => clearInterval(interval);
    }, 1200);

    return () => clearTimeout(startDelay);
  }, [prefersReducedMotion]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [visibleCount]);

  const visibleLines = CRAWL_LINES.slice(0, visibleCount);

  return (
    <div className="w-full max-w-lg">
      <div className="rounded-2xl bg-[#1C1917] border border-[#292524] overflow-hidden shadow-[0_24px_64px_rgba(0,0,0,0.12)]">
        {/* Title bar */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-[#292524]">
          <div className="flex gap-1.5">
            <div className="w-2.5 h-2.5 rounded-full bg-red-500/60" />
            <div className="w-2.5 h-2.5 rounded-full bg-yellow-500/60" />
            <div className="w-2.5 h-2.5 rounded-full bg-green-500/60" />
          </div>
          <span className="text-[11px] text-stone-500 font-mono ml-2">
            prodscope &mdash; analysis session
          </span>
        </div>

        {/* Terminal body */}
        <div
          ref={scrollRef}
          className="px-4 py-4 h-[320px] overflow-y-auto font-mono text-[13px] leading-relaxed"
        >
          {visibleLines.map((line, i) => (
            <motion.div
              key={i}
              initial={prefersReducedMotion ? {} : { opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
              className={`${TYPE_COLORS[line.type]} whitespace-pre`}
            >
              <span className="text-stone-600 select-none">
                {line.type === "info" && i === 0 ? "" : "\u25b8 "}
              </span>
              {line.text}
            </motion.div>
          ))}

          {visibleCount < CRAWL_LINES.length && (
            <span className="inline-block w-2 h-4 bg-stone-500 animate-pulse" />
          )}
        </div>
      </div>
    </div>
  );
}
