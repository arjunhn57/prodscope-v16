import { useId, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ChevronRight, Mail, Key, Target, AlertTriangle, KeyRound } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { EDITORIAL_EASE } from "../../report/tokens";
import type { StaticInputKey, StaticInputs, UploadMeta } from "../useUploadJob";

interface MetadataPanelProps {
  value: UploadMeta;
  onChange: (next: UploadMeta) => void;
  disabled?: boolean;
}

type SimpleKey = Exclude<keyof UploadMeta, "staticInputs">;

interface FieldConfig {
  key: SimpleKey;
  label: string;
  placeholder: string;
  icon: LucideIcon;
  type?: string;
  full?: boolean;
}

const FIELDS: FieldConfig[] = [
  {
    key: "email",
    label: "Email for report",
    placeholder: "team@company.com",
    icon: Mail,
    type: "email",
  },
  {
    key: "credentials",
    label: "Sign-in credentials",
    placeholder: '{"username": "demo", "password": "demo123"}',
    icon: Key,
    type: "text",
  },
  {
    key: "goals",
    label: "Analysis focus",
    placeholder: "Focus on checkout flow and payments",
    icon: Target,
    full: true,
  },
  {
    key: "painPoints",
    label: "Known pain points",
    placeholder: "Login page sometimes crashes on Android 13",
    icon: AlertTriangle,
    full: true,
  },
];

interface StaticInputConfig {
  key: StaticInputKey;
  label: string;
  placeholder: string;
}

// V16.1: Known-input codes the user wants us to try when the agent hits an
// auth wall (phone OTP, email verification, 2FA, CAPTCHA). If we're asked for
// the field and static is missing/wrong, a popup opens mid-crawl.
const STATIC_INPUT_FIELDS: StaticInputConfig[] = [
  { key: "otp", label: "Phone OTP", placeholder: "e.g. 123456" },
  { key: "email_code", label: "Email verification code", placeholder: "e.g. 482193" },
  { key: "2fa", label: "2FA code", placeholder: "e.g. 847210" },
  { key: "captcha", label: "CAPTCHA answer", placeholder: "e.g. rainbow" },
];

export function MetadataPanel({ value, onChange, disabled = false }: MetadataPanelProps) {
  const reduceMotion = useReducedMotion();
  const [open, setOpen] = useState(false);
  const panelId = useId();

  const update = (key: SimpleKey, v: string) => {
    onChange({ ...value, [key]: v });
  };

  const updateStaticInput = (key: StaticInputKey, v: string) => {
    const nextStatic: StaticInputs = { ...(value.staticInputs ?? {}) };
    if (v.length > 0) {
      nextStatic[key] = v;
    } else {
      delete nextStatic[key];
    }
    onChange({ ...value, staticInputs: nextStatic });
  };

  return (
    <div className="w-full">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((o) => !o)}
        className="group flex items-center gap-2 text-[13px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent-ring)] rounded-full px-3 py-1.5 transition-colors"
        style={{ fontFamily: "var(--font-sans)" }}
      >
        <motion.span
          animate={reduceMotion ? undefined : { rotate: open ? 90 : 0 }}
          transition={{ duration: 0.25, ease: EDITORIAL_EASE }}
          className="flex items-center"
        >
          <ChevronRight className="w-3.5 h-3.5" />
        </motion.span>
        <span>
          {open ? "Hide context" : "Add context"}
          <span className="text-[var(--color-text-muted)] ml-1">(optional)</span>
        </span>
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            id={panelId}
            key="panel"
            initial={reduceMotion ? { opacity: 0 } : { opacity: 0, height: 0 }}
            animate={reduceMotion ? { opacity: 1 } : { opacity: 1, height: "auto" }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, height: 0 }}
            transition={{ duration: 0.32, ease: EDITORIAL_EASE }}
            className="overflow-hidden"
          >
            <div
              className="mt-4 rounded-[20px] p-5 md:p-6"
              style={{
                background: "#FFFFFF",
                border: "1px solid #E2E8F0",
                boxShadow: "0 1px 3px rgba(15,23,42,0.04), 0 8px 24px -12px rgba(15,23,42,0.08)",
              }}
            >
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-5">
                {FIELDS.map((field) => (
                  <Field
                    key={field.key}
                    config={field}
                    value={(value[field.key] as string | undefined) ?? ""}
                    onChange={(v) => update(field.key, v)}
                    disabled={disabled}
                  />
                ))}
              </div>

              <KnownInputsSection
                values={value.staticInputs ?? {}}
                onChange={updateStaticInput}
                disabled={disabled}
              />

              <p
                className="mt-5 text-[11.5px] text-[var(--color-text-muted)] leading-relaxed"
                style={{ fontFamily: "var(--font-sans)" }}
              >
                All fields are optional. Context helps us prioritize the right flows during analysis.
                Credentials are encrypted at rest and removed with the APK.
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

interface KnownInputsSectionProps {
  values: StaticInputs;
  onChange: (key: StaticInputKey, v: string) => void;
  disabled?: boolean;
}

function KnownInputsSection({ values, onChange, disabled }: KnownInputsSectionProps) {
  const reduceMotion = useReducedMotion();
  const [open, setOpen] = useState(false);
  const panelId = useId();

  return (
    <div className="mt-5 pt-5 border-t border-[var(--color-border,#E2E8F0)]">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((o) => !o)}
        className="group flex items-center gap-2 text-[12.5px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent-ring)] rounded-full px-2 py-1 transition-colors"
        style={{ fontFamily: "var(--font-sans)" }}
      >
        <motion.span
          animate={reduceMotion ? undefined : { rotate: open ? 90 : 0 }}
          transition={{ duration: 0.25, ease: EDITORIAL_EASE }}
          className="flex items-center"
        >
          <ChevronRight className="w-3.5 h-3.5" />
        </motion.span>
        <KeyRound className="w-3.5 h-3.5" />
        <span>
          Known login codes
          <span className="text-[var(--color-text-muted)] ml-1">(optional)</span>
        </span>
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            id={panelId}
            key="known-inputs"
            initial={reduceMotion ? { opacity: 0 } : { opacity: 0, height: 0 }}
            animate={reduceMotion ? { opacity: 1 } : { opacity: 1, height: "auto" }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, height: 0 }}
            transition={{ duration: 0.28, ease: EDITORIAL_EASE }}
            className="overflow-hidden"
          >
            <p
              className="mt-3 mb-3 text-[11.5px] text-[var(--color-text-muted)] leading-relaxed"
              style={{ fontFamily: "var(--font-sans)" }}
            >
              If the app needs an OTP, 2FA, or CAPTCHA to log in, enter a code we
              can try. If it doesn't work, we'll pop up a prompt during the run
              so you can paste the real one.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-4">
              {STATIC_INPUT_FIELDS.map((field) => (
                <StaticInputField
                  key={field.key}
                  config={field}
                  value={values[field.key] ?? ""}
                  onChange={(v) => onChange(field.key, v)}
                  disabled={disabled}
                />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

interface StaticInputFieldProps {
  config: StaticInputConfig;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}

function StaticInputField({ config, value, onChange, disabled }: StaticInputFieldProps) {
  const inputId = useId();
  return (
    <div>
      <label
        htmlFor={inputId}
        className="flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.2em] text-[var(--color-text-muted)] mb-2"
        style={{ fontFamily: "var(--font-label)" }}
      >
        {config.label}
      </label>
      <input
        id={inputId}
        type="text"
        inputMode="text"
        autoComplete="off"
        spellCheck={false}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={config.placeholder}
        disabled={disabled}
        maxLength={256}
        className="w-full rounded-xl px-3.5 py-2.5 text-[13px] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent-ring)] transition-colors disabled:opacity-60"
        style={{
          background: "#F8FAFC",
          border: "1px solid #E2E8F0",
          fontFamily: "var(--font-sans)",
        }}
      />
    </div>
  );
}

interface FieldProps {
  config: FieldConfig;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}

function Field({ config, value, onChange, disabled }: FieldProps) {
  const inputId = useId();
  const Icon = config.icon;
  return (
    <div className={config.full ? "md:col-span-2" : undefined}>
      <label
        htmlFor={inputId}
        className="flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.2em] text-[var(--color-text-muted)] mb-2"
        style={{ fontFamily: "var(--font-label)" }}
      >
        <Icon className="w-3 h-3" />
        {config.label}
      </label>
      <input
        id={inputId}
        type={config.type ?? "text"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={config.placeholder}
        disabled={disabled}
        className="w-full rounded-xl px-3.5 py-2.5 text-[13px] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent-ring)] transition-colors disabled:opacity-60"
        style={{
          background: "#F8FAFC",
          border: "1px solid #E2E8F0",
          fontFamily: "var(--font-sans)",
        }}
      />
    </div>
  );
}
