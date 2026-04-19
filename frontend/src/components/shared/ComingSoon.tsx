import { useNavigate } from "react-router-dom";
import { motion, useReducedMotion } from "framer-motion";
import { ArrowLeft, type LucideIcon } from "lucide-react";
import { EDITORIAL_EASE, REPORT_GRADIENTS } from "../../features/report/tokens";

interface ComingSoonProps {
  icon: LucideIcon;
  title: string;
  description: string;
  eyebrow?: string;
  backHref?: string;
  backLabel?: string;
}

export function ComingSoon({
  icon: Icon,
  title,
  description,
  eyebrow = "Available in Q2",
  backHref = "/dashboard",
  backLabel = "Back to dashboard",
}: ComingSoonProps) {
  const navigate = useNavigate();
  const reduceMotion = useReducedMotion();

  return (
    <div className="relative min-h-[72vh] flex items-center justify-center px-6 py-16 overflow-hidden">
      <AuroraBackdrop />

      <motion.div
        initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.55, ease: EDITORIAL_EASE }}
        className="relative z-10 flex flex-col items-center text-center max-w-[540px]"
      >
        <div
          className="w-16 h-16 rounded-2xl flex items-center justify-center mb-8"
          style={{
            background: REPORT_GRADIENTS.auroraTile,
            border: "1px solid rgba(108,71,255,0.22)",
            boxShadow: "0 1px 3px rgba(15,23,42,0.04), 0 12px 32px -16px rgba(108,71,255,0.24)",
          }}
        >
          <Icon
            className="w-7 h-7"
            style={{ color: "#6C47FF" }}
            strokeWidth={1.6}
          />
        </div>

        <span
          className="text-[10.5px] font-semibold uppercase tracking-[0.24em] text-[var(--color-text-muted)]"
          style={{ fontFamily: "var(--font-label)" }}
        >
          {eyebrow}
        </span>

        <h1
          className="mt-4 text-[32px] md:text-[40px] font-semibold text-[var(--color-text-primary)] leading-[1.1]"
          style={{ fontFamily: "var(--font-heading)", letterSpacing: "-0.025em" }}
        >
          {title}
        </h1>

        <p
          className="mt-5 text-[15px] text-[var(--color-text-secondary)] leading-[1.65]"
          style={{ fontFamily: "var(--font-sans)" }}
        >
          {description}
        </p>

        <button
          type="button"
          onClick={() => navigate(backHref)}
          className="mt-10 inline-flex items-center gap-2 px-5 py-2.5 rounded-full text-[13px] font-medium text-[var(--color-text-primary)] bg-white border border-[var(--color-border-subtle)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent-ring)] transition-all hover:border-[rgba(108,71,255,0.28)] hover:-translate-y-[1px]"
          style={{
            boxShadow: "0 1px 3px rgba(15,23,42,0.04), 0 8px 20px -12px rgba(15,23,42,0.12)",
            fontFamily: "var(--font-sans)",
          }}
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          {backLabel}
        </button>
      </motion.div>
    </div>
  );
}

function AuroraBackdrop() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0"
      style={{
        background:
          "radial-gradient(ellipse 60% 50% at 50% 30%, rgba(138,108,255,0.14) 0%, rgba(138,108,255,0) 70%), radial-gradient(ellipse 50% 40% at 80% 80%, rgba(219,39,119,0.10) 0%, rgba(219,39,119,0) 65%), radial-gradient(ellipse 50% 40% at 15% 75%, rgba(108,71,255,0.10) 0%, rgba(108,71,255,0) 65%)",
      }}
    />
  );
}
