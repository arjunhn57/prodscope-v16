import { useNavigate } from "react-router-dom";
import { motion, useReducedMotion } from "framer-motion";
import { ArrowRight } from "lucide-react";
import { EDITORIAL_EASE, REPORT_GRADIENTS } from "../../report/tokens";

export function RecentAnalysesEmpty() {
  const navigate = useNavigate();
  const reduceMotion = useReducedMotion();

  return (
    <motion.div
      initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: EDITORIAL_EASE }}
      className="flex flex-col items-center text-center py-10 md:py-14 px-6"
    >
      <CorpusIllustration />
      <h3
        className="mt-6 text-[20px] md:text-[22px] font-semibold text-[var(--color-text-primary)]"
        style={{ fontFamily: "var(--font-heading)", letterSpacing: "-0.015em" }}
      >
        Your corpus starts here.
      </h3>
      <p
        className="mt-2 text-[14px] text-[var(--color-text-secondary)] leading-[1.6] max-w-[420px]"
        style={{ fontFamily: "var(--font-sans)" }}
      >
        Every APK you analyze feeds the intelligence engine. Drop your first build to populate this feed.
      </p>
      <button
        type="button"
        onClick={() => navigate("/upload")}
        className="mt-6 inline-flex items-center gap-2 px-5 py-2.5 rounded-full text-[13px] font-semibold text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent-ring)] transition-all hover:brightness-110"
        style={{
          background: REPORT_GRADIENTS.hero,
          boxShadow: "0 8px 24px -12px rgba(108,71,255,0.35)",
          fontFamily: "var(--font-sans)",
        }}
      >
        Upload your first APK
        <ArrowRight className="w-3.5 h-3.5" />
      </button>
    </motion.div>
  );
}

function CorpusIllustration() {
  return (
    <svg
      width="120"
      height="120"
      viewBox="0 0 120 120"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="corpus-face-top" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#8A6CFF" />
          <stop offset="60%" stopColor="#6C47FF" />
          <stop offset="100%" stopColor="#DB2777" />
        </linearGradient>
        <linearGradient id="corpus-face-left" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#6C47FF" stopOpacity="0.85" />
          <stop offset="100%" stopColor="#4C1D95" stopOpacity="0.9" />
        </linearGradient>
        <linearGradient id="corpus-face-right" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#DB2777" stopOpacity="0.85" />
          <stop offset="100%" stopColor="#831843" stopOpacity="0.9" />
        </linearGradient>
        <radialGradient id="corpus-halo" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#8A6CFF" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#8A6CFF" stopOpacity="0" />
        </radialGradient>
      </defs>

      <circle cx="60" cy="62" r="54" fill="url(#corpus-halo)" />

      <polygon points="60,22 96,42 60,62 24,42" fill="url(#corpus-face-top)" />
      <polygon points="24,42 60,62 60,100 24,80" fill="url(#corpus-face-left)" />
      <polygon points="96,42 60,62 60,100 96,80" fill="url(#corpus-face-right)" />

      <polyline
        points="60,22 60,62"
        stroke="rgba(255,255,255,0.35)"
        strokeWidth="1"
        fill="none"
      />
      <polyline
        points="60,62 60,100"
        stroke="rgba(255,255,255,0.18)"
        strokeWidth="1"
        fill="none"
      />

      <circle cx="60" cy="22" r="3" fill="#FFFFFF" opacity="0.95" />
      <circle cx="96" cy="42" r="2.5" fill="#FFFFFF" opacity="0.75" />
      <circle cx="24" cy="42" r="2.5" fill="#FFFFFF" opacity="0.75" />
    </svg>
  );
}
