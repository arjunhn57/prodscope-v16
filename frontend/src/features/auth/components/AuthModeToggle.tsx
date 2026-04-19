import { useRef } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { EDITORIAL_EASE } from "../../report/tokens";

export type AuthMode = "signup" | "signin";

interface AuthModeToggleProps {
  value: AuthMode;
  onChange: (value: AuthMode) => void;
}

const OPTIONS: { value: AuthMode; label: string }[] = [
  { value: "signup", label: "Sign up" },
  { value: "signin", label: "Sign in" },
];

export function AuthModeToggle({ value, onChange }: AuthModeToggleProps) {
  const reduceMotion = useReducedMotion();
  const refs = useRef<Record<AuthMode, HTMLButtonElement | null>>({
    signup: null,
    signin: null,
  });

  const handleKey = (
    e: React.KeyboardEvent<HTMLButtonElement>,
    idx: number
  ) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const nextIdx =
      e.key === "ArrowRight"
        ? (idx + 1) % OPTIONS.length
        : (idx - 1 + OPTIONS.length) % OPTIONS.length;
    const next = OPTIONS[nextIdx];
    onChange(next.value);
    refs.current[next.value]?.focus();
  };

  return (
    <div
      role="radiogroup"
      aria-label="Authentication mode"
      className="inline-flex items-center gap-1 p-1 rounded-full"
      style={{
        background: "rgba(239,235,255,0.6)",
        border: "1px solid rgba(108,71,255,0.18)",
        boxShadow: "inset 0 1px 2px rgba(15,23,42,0.04)",
      }}
    >
      {OPTIONS.map((opt, idx) => {
        const selected = value === opt.value;
        return (
          <button
            key={opt.value}
            ref={(el) => {
              refs.current[opt.value] = el;
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(opt.value)}
            onKeyDown={(e) => handleKey(e, idx)}
            className="relative inline-flex items-center px-4 py-1.5 rounded-full text-[13px] font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent-ring,rgba(108,71,255,0.5))] cursor-pointer"
            style={{
              fontFamily: "var(--font-sans)",
              color: selected ? "#0F172A" : "#64748B",
              transition: reduceMotion
                ? "none"
                : "color 180ms cubic-bezier(0.22,0.61,0.36,1)",
            }}
          >
            {selected && (
              <motion.span
                layoutId="auth-mode-pill"
                className="absolute inset-0 rounded-full"
                style={{
                  background: "#FFFFFF",
                  boxShadow:
                    "0 1px 2px rgba(15,23,42,0.06), 0 4px 12px -4px rgba(108,71,255,0.18)",
                }}
                transition={
                  reduceMotion
                    ? { duration: 0 }
                    : { duration: 0.25, ease: EDITORIAL_EASE }
                }
              />
            )}
            <span className="relative z-10">{opt.label}</span>
          </button>
        );
      })}
    </div>
  );
}
