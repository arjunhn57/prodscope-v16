import { useId, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ChevronRight, Mail, Key, Target, AlertTriangle, KeyRound, Lock, Eye } from "lucide-react";
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
    full: true,
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

// Credentials are transported as a JSON string (`credentials` in UploadMeta)
// so the backend multipart contract is unchanged. The panel renders two real
// inputs (email + password) and (de)serializes on every keystroke.
function parseCredsJson(raw: string): { email: string; password: string } {
  if (!raw) return { email: "", password: "" };
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      return {
        email: typeof parsed.email === "string" ? parsed.email : "",
        password: typeof parsed.password === "string" ? parsed.password : "",
      };
    }
  } catch {
    // Legacy free-text input — drop it; user retypes.
  }
  return { email: "", password: "" };
}

function serializeCreds(email: string, password: string): string {
  const payload: Record<string, string> = {};
  const trimmedEmail = email.trim();
  if (trimmedEmail) payload.email = trimmedEmail;
  if (password) payload.password = password;
  if (Object.keys(payload).length === 0) return "";
  return JSON.stringify(payload);
}

interface StaticInputConfig {
  key: StaticInputKey;
  label: string;
  placeholder: string;
}

const STATIC_INPUT_FIELDS: StaticInputConfig[] = [
  { key: "otp", label: "Phone OTP", placeholder: "e.g. 123456" },
  { key: "email_code", label: "Email verification code", placeholder: "e.g. 482193" },
  { key: "2fa", label: "2FA code", placeholder: "e.g. 847210" },
  { key: "captcha", label: "CAPTCHA answer", placeholder: "e.g. rainbow" },
];

type AnalysisMode = "full" | "public";

export function MetadataPanel({ value, onChange, disabled = false }: MetadataPanelProps) {
  const reduceMotion = useReducedMotion();
  const [open, setOpen] = useState(false);
  const panelId = useId();

  // Default to full-app — that's the deliverable users buy. Public mode is a
  // first-class opt-out for analysts who can't get test credentials (VCs
  // analyzing a competitor, PMs comparing a rival app, etc).
  const [mode, setMode] = useState<AnalysisMode>("full");

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

  const handleModeChange = (next: AnalysisMode) => {
    setMode(next);
    // Clear credentials + static inputs when flipping to public mode so the
    // backend doesn't receive stale data the user thought they hid.
    if (next === "public") {
      onChange({ ...value, credentials: "", staticInputs: {} });
    }
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
              <ModeToggle mode={mode} onChange={handleModeChange} disabled={disabled} />

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-5 mt-5">
                <CredentialsFields
                  value={value.credentials ?? ""}
                  onChange={(next) => onChange({ ...value, credentials: next })}
                  disabled={disabled || mode === "public"}
                  publicMode={mode === "public"}
                />
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

              {mode === "full" && (
                <KnownInputsSection
                  values={value.staticInputs ?? {}}
                  onChange={updateStaticInput}
                  disabled={disabled}
                />
              )}

              <p
                className="mt-5 text-[11.5px] text-[var(--color-text-muted)] leading-relaxed"
                style={{ fontFamily: "var(--font-sans)" }}
              >
                All fields are optional. Context helps us prioritize the right flows during analysis.
                Credentials are encrypted at rest and never logged.
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

interface ModeToggleProps {
  mode: AnalysisMode;
  onChange: (m: AnalysisMode) => void;
  disabled?: boolean;
}

function ModeToggle({ mode, onChange, disabled }: ModeToggleProps) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <ModeOption
        active={mode === "full"}
        onClick={() => onChange("full")}
        disabled={disabled}
        Icon={Lock}
        title="Full app"
        subtitle="Provide credentials — analyzes everything behind login"
      />
      <ModeOption
        active={mode === "public"}
        onClick={() => onChange("public")}
        disabled={disabled}
        Icon={Eye}
        title="Public surface only"
        subtitle="No login required — pre-auth flows, paywalls, free tier"
      />
    </div>
  );
}

interface ModeOptionProps {
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
  Icon: LucideIcon;
  title: string;
  subtitle: string;
}

function ModeOption({ active, onClick, disabled, Icon, title, subtitle }: ModeOptionProps) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      disabled={disabled}
      className="text-left rounded-xl px-4 py-3.5 transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent-ring)] disabled:opacity-60"
      style={{
        background: active ? "rgba(108,71,255,0.06)" : "#F8FAFC",
        border: active ? "1.5px solid var(--color-accent)" : "1px solid #E2E8F0",
      }}
    >
      <div
        className="flex items-center gap-2 text-[12.5px] font-semibold text-[var(--color-text-primary)]"
        style={{ fontFamily: "var(--font-label)" }}
      >
        <Icon
          className="w-3.5 h-3.5"
          style={{ color: active ? "var(--color-accent)" : "var(--color-text-muted)" }}
        />
        {title}
      </div>
      <p
        className="mt-1 text-[11.5px] text-[var(--color-text-secondary)] leading-[1.5]"
        style={{ fontFamily: "var(--font-sans)" }}
      >
        {subtitle}
      </p>
    </button>
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

interface CredentialsFieldsProps {
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
  publicMode?: boolean;
}

function CredentialsFields({ value, onChange, disabled, publicMode }: CredentialsFieldsProps) {
  const emailId = useId();
  const passwordId = useId();
  const { email, password } = parseCredsJson(value);

  const inputStyle = {
    background: publicMode ? "#F1F5F9" : "#F8FAFC",
    border: "1px solid #E2E8F0",
    fontFamily: "var(--font-sans)",
  } as const;
  const inputClass =
    "w-full rounded-xl px-3.5 py-2.5 text-[13px] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent-ring)] transition-colors disabled:opacity-60";

  return (
    <div className="md:col-span-2">
      <div
        className="flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.2em] text-[var(--color-text-muted)] mb-2"
        style={{ fontFamily: "var(--font-label)" }}
      >
        <Key className="w-3 h-3" />
        <span>Sign-in credentials</span>
        <span className="ml-1 text-[10px] font-normal normal-case tracking-normal text-[var(--color-text-muted)]">
          {publicMode
            ? "(disabled in Public surface mode)"
            : "(used to cross login walls; encrypted at rest, never logged)"}
        </span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-4">
        <input
          id={emailId}
          type="email"
          autoComplete="username"
          inputMode="email"
          value={publicMode ? "" : email}
          onChange={(e) => onChange(serializeCreds(e.target.value, password))}
          placeholder={publicMode ? "Switch to Full app to enable" : "Login email"}
          disabled={disabled}
          maxLength={256}
          className={inputClass}
          style={inputStyle}
          aria-label="Login email"
        />
        <input
          id={passwordId}
          type="password"
          autoComplete="current-password"
          value={publicMode ? "" : password}
          onChange={(e) => onChange(serializeCreds(email, e.target.value))}
          placeholder={publicMode ? "Switch to Full app to enable" : "Password"}
          disabled={disabled}
          maxLength={256}
          className={inputClass}
          style={inputStyle}
          aria-label="Password"
        />
      </div>
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
