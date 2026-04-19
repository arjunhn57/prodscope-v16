import { useId, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ChevronRight, Mail, Key, Target, AlertTriangle } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { EDITORIAL_EASE } from "../../report/tokens";
import type { UploadMeta } from "../useUploadJob";

interface MetadataPanelProps {
  value: UploadMeta;
  onChange: (next: UploadMeta) => void;
  disabled?: boolean;
}

interface FieldConfig {
  key: keyof UploadMeta;
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

export function MetadataPanel({ value, onChange, disabled = false }: MetadataPanelProps) {
  const reduceMotion = useReducedMotion();
  const [open, setOpen] = useState(false);
  const panelId = useId();

  const update = (key: keyof UploadMeta, v: string) => {
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
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-5">
                {FIELDS.map((field) => (
                  <Field
                    key={field.key}
                    config={field}
                    value={value[field.key] ?? ""}
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
                Credentials are encrypted at rest and removed with the APK.
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
