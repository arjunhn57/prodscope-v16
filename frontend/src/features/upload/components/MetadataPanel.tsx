import { useId, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ChevronRight, Mail, Target, AlertTriangle, KeyRound } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { EDITORIAL_EASE } from "../../report/tokens";
import type { UploadMeta } from "../useUploadJob";

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

// 2026-04-26 (Item #5): V1 ships pre-auth-only — credential-collection
// helpers (parseCredsJson, serializeCreds, STATIC_INPUT_FIELDS,
// CredentialsFields, KnownInputsSection, StaticInputField) and their
// types were removed in this commit. The pre-auth banner inside the
// panel replaces the credential surface. When V1.5 ships full-app
// mode, restore the helpers via git history.

export function MetadataPanel({ value, onChange, disabled = false }: MetadataPanelProps) {
  const reduceMotion = useReducedMotion();
  const [open, setOpen] = useState(false);
  const panelId = useId();

  const update = (key: SimpleKey, v: string) => {
    onChange({ ...value, [key]: v });
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
              {/* 2026-04-26 (Item #5): V1 pre-auth-only — credentials field
                  is hidden behind a "request access" banner. ProdScope V1
                  analyzes only the public, pre-login surface so we never
                  ask for or store user credentials. Full-app mode (with
                  creds) ships in V1.5; the mailto link captures interest. */}
              <div
                className="mb-4 rounded-xl px-4 py-3.5"
                style={{
                  background:
                    "linear-gradient(180deg, rgba(108,71,255,0.04) 0%, rgba(108,71,255,0.07) 100%)",
                  border: "1px solid rgba(108,71,255,0.18)",
                }}
              >
                <div
                  className="flex items-center gap-2 text-[12.5px] font-semibold text-[var(--color-text-primary)]"
                  style={{ fontFamily: "var(--font-label)" }}
                >
                  <KeyRound className="w-3.5 h-3.5 text-[var(--color-accent)]" />
                  Pre-auth analysis — no credentials needed
                </div>
                <p
                  className="mt-1.5 text-[12px] text-[var(--color-text-secondary)] leading-[1.55]"
                  style={{ fontFamily: "var(--font-sans)" }}
                >
                  ProdScope analyzes the public, pre-login surface of any
                  app — sign-in flows, paywalls, onboarding, free-tier
                  content. Need full-app analysis behind a login?{" "}
                  <a
                    className="text-[var(--color-accent)] font-semibold hover:underline"
                    href="mailto:hello@prodscope.app?subject=Full-app%20analysis%20mode%20%E2%80%94%20request%20access"
                  >
                    Request early access &rarr;
                  </a>
                </p>
              </div>

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

              <p
                className="mt-5 text-[11.5px] text-[var(--color-text-muted)] leading-relaxed"
                style={{ fontFamily: "var(--font-sans)" }}
              >
                All fields are optional. Context helps us prioritize the right flows during analysis.
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
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
