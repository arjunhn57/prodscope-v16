import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { KeyRound, ShieldCheck, X } from "lucide-react";
import { cancelHumanInput, postHumanInput } from "../../../api/hooks";

export type HumanInputField = "otp" | "email_code" | "2fa" | "captcha";

interface HumanInputModalProps {
  jobId: string;
  field: HumanInputField;
  prompt: string;
  timeoutMs: number;
  onClose: () => void;
}

const FIELD_COPY: Record<
  HumanInputField,
  { title: string; placeholder: string; inputMode: "numeric" | "text"; maxLength: number }
> = {
  otp: {
    title: "Phone OTP needed",
    placeholder: "Enter the 6-digit code you received",
    inputMode: "numeric",
    maxLength: 12,
  },
  email_code: {
    title: "Email verification code needed",
    placeholder: "Paste the code from the email",
    inputMode: "text",
    maxLength: 24,
  },
  "2fa": {
    title: "Two-factor code needed",
    placeholder: "Enter the 2FA code from your authenticator",
    inputMode: "numeric",
    maxLength: 12,
  },
  captcha: {
    title: "CAPTCHA needed",
    placeholder: "Type what you see in the CAPTCHA",
    inputMode: "text",
    maxLength: 64,
  },
};

function fmtCountdown(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const mm = Math.floor(totalSec / 60).toString().padStart(2, "0");
  const ss = (totalSec % 60).toString().padStart(2, "0");
  return `${mm}:${ss}`;
}

export function HumanInputModal({
  jobId,
  field,
  prompt,
  timeoutMs,
  onClose,
}: HumanInputModalProps) {
  const reduceMotion = useReducedMotion();
  const copy = FIELD_COPY[field];
  const [value, setValue] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const deadline = useMemo(() => Date.now() + Math.max(0, timeoutMs), [timeoutMs]);
  const [remaining, setRemaining] = useState<number>(deadline - Date.now());

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const id = window.setInterval(() => {
      setRemaining(deadline - Date.now());
    }, 500);
    return () => window.clearInterval(id);
  }, [deadline]);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !submitting && !cancelling) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose, submitting, cancelling]);

  const disabled = submitting || cancelling;
  const canSubmit = value.trim().length > 0 && !disabled;

  const handleSubmit = useCallback(
    async (e?: React.FormEvent) => {
      e?.preventDefault();
      if (!canSubmit) return;
      setSubmitting(true);
      setError(null);
      try {
        await postHumanInput(jobId, value.trim(), field);
        onClose();
      } catch (err) {
        const msg =
          err instanceof Error ? err.message : "Couldn't send code. Try again.";
        setError(msg);
        setSubmitting(false);
      }
    },
    [canSubmit, jobId, value, field, onClose]
  );

  const handleCancel = useCallback(async () => {
    if (disabled) return;
    setCancelling(true);
    setError(null);
    try {
      await cancelHumanInput(jobId);
      onClose();
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Couldn't stop the crawl. Try again.";
      setError(msg);
      setCancelling(false);
    }
  }, [disabled, jobId, onClose]);

  return (
    <AnimatePresence>
      <motion.div
        key="human-input-backdrop"
        className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/70 backdrop-blur-sm px-4 pb-[max(16px,env(safe-area-inset-bottom))] pt-4 md:py-10"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
      >
        <motion.div
          role="dialog"
          aria-modal="true"
          aria-labelledby="human-input-title"
          className="relative w-full max-w-md rounded-3xl overflow-hidden"
          initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 24, scale: 0.98 }}
          animate={reduceMotion ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
          exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 24, scale: 0.98 }}
          transition={{ type: "spring", damping: 30, stiffness: 320 }}
          style={{
            background: "#FFFFFF",
            boxShadow:
              "0 24px 60px -20px rgba(0,0,0,0.55), 0 8px 20px -8px rgba(0,0,0,0.25)",
          }}
        >
          <div
            className="px-5 pt-5 pb-4 flex items-start gap-3"
            style={{
              background:
                "linear-gradient(135deg, rgba(108,71,255,0.06) 0%, rgba(219,39,119,0.04) 100%)",
              borderBottom: "1px solid #E2E8F0",
            }}
          >
            <div
              className="flex-shrink-0 w-10 h-10 rounded-2xl flex items-center justify-center"
              style={{
                background: "linear-gradient(135deg, #6C47FF 0%, #DB2777 100%)",
                color: "white",
              }}
              aria-hidden="true"
            >
              <KeyRound className="w-5 h-5" />
            </div>
            <div className="flex-1 min-w-0">
              <h2
                id="human-input-title"
                className="text-[15px] font-semibold text-[var(--color-text-primary,#0F172A)] leading-tight"
                style={{ fontFamily: "var(--font-heading)" }}
              >
                {copy.title}
              </h2>
              <p
                className="mt-1 text-[12.5px] text-[var(--color-text-secondary,#475569)] leading-snug"
                style={{ fontFamily: "var(--font-sans)" }}
              >
                {prompt || "The app is asking for a code only you have."}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              disabled={disabled}
              aria-label="Close"
              className="w-8 h-8 rounded-full flex items-center justify-center text-[var(--color-text-muted,#64748B)] hover:text-[var(--color-text-primary,#0F172A)] hover:bg-black/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent-ring,#6C47FF)] disabled:opacity-40"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <form onSubmit={handleSubmit} className="px-5 pt-5 pb-5">
            <label
              htmlFor="human-input-value"
              className="block text-[10.5px] font-semibold uppercase tracking-[0.2em] text-[var(--color-text-muted,#64748B)] mb-2"
              style={{ fontFamily: "var(--font-label)" }}
            >
              Code
            </label>
            <input
              id="human-input-value"
              ref={inputRef}
              type="text"
              inputMode={copy.inputMode}
              autoComplete="one-time-code"
              spellCheck={false}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={copy.placeholder}
              maxLength={copy.maxLength}
              disabled={disabled}
              className="w-full rounded-xl px-4 py-3 text-[15px] tracking-wide text-[var(--color-text-primary,#0F172A)] placeholder:text-[var(--color-text-muted,#94A3B8)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent-ring,#6C47FF)] transition-colors disabled:opacity-60"
              style={{
                background: "#F8FAFC",
                border: "1px solid #E2E8F0",
                fontFamily: "var(--font-mono)",
              }}
            />

            {error && (
              <p
                className="mt-3 text-[12px] text-[#B91C1C]"
                style={{ fontFamily: "var(--font-sans)" }}
                role="alert"
              >
                {error}
              </p>
            )}

            <div className="mt-4 flex items-center justify-between gap-3 text-[11.5px] text-[var(--color-text-muted,#64748B)]">
              <span
                className="inline-flex items-center gap-1.5"
                style={{ fontFamily: "var(--font-sans)" }}
              >
                <ShieldCheck className="w-3.5 h-3.5" />
                Sent securely to this crawl only
              </span>
              <span
                className="tabular-nums"
                style={{ fontFamily: "var(--font-mono)" }}
                aria-label="Time remaining"
              >
                {fmtCountdown(remaining)}
              </span>
            </div>

            <button
              type="submit"
              disabled={!canSubmit}
              className="mt-4 w-full inline-flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-[14px] font-semibold text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(138,108,255,0.5)] transition-[transform,opacity] active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
              style={{
                background: "linear-gradient(135deg, #6C47FF 0%, #8A6CFF 50%, #DB2777 100%)",
                boxShadow: "0 12px 28px -12px rgba(108,71,255,0.55)",
                fontFamily: "var(--font-sans)",
              }}
            >
              {submitting ? "Sending…" : "Send to crawl"}
            </button>

            <button
              type="button"
              onClick={handleCancel}
              disabled={disabled}
              className="mt-2.5 w-full inline-flex items-center justify-center rounded-xl px-4 py-2.5 text-[12.5px] font-medium text-[var(--color-text-secondary,#475569)] hover:text-[var(--color-text-primary,#0F172A)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent-ring,#6C47FF)] transition-colors disabled:opacity-50"
              style={{ fontFamily: "var(--font-sans)" }}
            >
              {cancelling ? "Stopping…" : "I can't get the code — stop the crawl"}
            </button>
          </form>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
