import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { motion, useReducedMotion } from "framer-motion";
import { ArrowLeft, CheckCircle2, Loader2 } from "lucide-react";
import { useSubmitApplication, type ApplicationInput } from "./applyApi";

const PAGE_BG = [
  "radial-gradient(80% 50% at 50% 0%, rgba(108,71,255,0.08) 0%, rgba(108,71,255,0) 55%)",
  "radial-gradient(60% 50% at 50% 0%, rgba(219,39,119,0.05) 0%, rgba(219,39,119,0) 60%)",
  "#FAFAFA",
].join(", ");

const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];

interface FormState {
  name: string;
  email: string;
  appName: string;
  playStoreUrl: string;
  whyNow: string;
  website: string;
}

const INITIAL: FormState = {
  name: "",
  email: "",
  appName: "",
  playStoreUrl: "",
  whyNow: "",
  website: "",
};

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return "Something went wrong. Please try again.";
}

export function ApplyPage() {
  const reduceMotion = useReducedMotion();
  const [values, setValues] = useState<FormState>(INITIAL);
  const [touched, setTouched] = useState<Partial<Record<keyof FormState, boolean>>>({});
  const submit = useSubmitApplication();

  const errors = validate(values);
  const hasErrors = Object.keys(errors).length > 0;

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setTouched({ name: true, email: true, appName: true, playStoreUrl: true, whyNow: true });
    if (hasErrors) return;

    const payload: ApplicationInput = {
      name: values.name.trim(),
      email: values.email.trim(),
      appName: values.appName.trim(),
      playStoreUrl: values.playStoreUrl.trim() || undefined,
      whyNow: values.whyNow.trim() || undefined,
      website: values.website, // honeypot
    };
    submit.mutate(payload);
  };

  const update = (key: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setValues((v) => ({ ...v, [key]: e.target.value }));
  };
  const blur = (key: keyof FormState) => () => {
    setTouched((t) => ({ ...t, [key]: true }));
  };

  const showError = (key: keyof FormState) => touched[key] && errors[key];

  return (
    <div className="flex flex-col min-h-dvh" style={{ background: PAGE_BG }}>
      <header className="border-b border-[var(--color-border-subtle)] bg-white">
        <div className="mx-auto max-w-[960px] px-4 md:px-8 lg:px-10 py-4 flex items-center justify-between">
          <Link
            to="/"
            className="text-[15px] font-semibold text-[var(--color-text-primary)] tracking-tight focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent-ring)] rounded"
            style={{ fontFamily: "var(--font-heading)" }}
          >
            ProdScope
          </Link>
          <Link
            to="/"
            className="inline-flex items-center gap-1.5 text-[13px] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Back
          </Link>
        </div>
      </header>

      <main className="flex-1 w-full">
        <div className="mx-auto max-w-[720px] px-4 md:px-8 lg:px-10 py-14 md:py-20">
          {submit.isSuccess ? (
            <SuccessState email={values.email} />
          ) : (
            <motion.div
              initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 8 }}
              animate={reduceMotion ? { opacity: 1 } : { opacity: 1, y: 0 }}
              transition={{ duration: 0.4, ease: EASE }}
            >
              <div
                className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[var(--color-text-muted)]"
                style={{ fontFamily: "var(--font-label)" }}
              >
                Private beta
              </div>
              <h1
                className="mt-3 text-[34px] md:text-[42px] font-semibold leading-[1.05] text-[var(--color-text-primary)]"
                style={{ fontFamily: "var(--font-heading)", letterSpacing: "-0.02em" }}
              >
                Apply as a design partner
              </h1>
              <p
                className="mt-4 text-[15px] leading-[1.65] text-[var(--color-text-secondary)] max-w-[560px]"
                style={{ fontFamily: "var(--font-sans)" }}
              >
                We're onboarding 10 founders this month. You get unlimited free
                analysis runs on your production app. In return, we ask for
                honest feedback and a short non-binding letter of intent for
                our eventual paid launch.
              </p>

              <form onSubmit={onSubmit} className="mt-10 space-y-5" noValidate>
                <Field
                  label="Your name"
                  name="name"
                  required
                  value={values.name}
                  error={showError("name") ? errors.name : undefined}
                  onChange={update("name")}
                  onBlur={blur("name")}
                  autoComplete="name"
                />
                <Field
                  label="Work email"
                  name="email"
                  type="email"
                  required
                  value={values.email}
                  error={showError("email") ? errors.email : undefined}
                  onChange={update("email")}
                  onBlur={blur("email")}
                  autoComplete="email"
                />
                <Field
                  label="App name"
                  name="appName"
                  required
                  value={values.appName}
                  error={showError("appName") ? errors.appName : undefined}
                  onChange={update("appName")}
                  onBlur={blur("appName")}
                />
                <Field
                  label="Play Store URL"
                  name="playStoreUrl"
                  hint="Optional — helps us confirm the app before the call."
                  value={values.playStoreUrl}
                  error={showError("playStoreUrl") ? errors.playStoreUrl : undefined}
                  onChange={update("playStoreUrl")}
                  onBlur={blur("playStoreUrl")}
                  placeholder="https://play.google.com/store/apps/details?id=…"
                />
                <TextareaField
                  label="Why now?"
                  name="whyNow"
                  hint="One sentence. What's the specific thing you want ProdScope to look at first?"
                  value={values.whyNow}
                  error={showError("whyNow") ? errors.whyNow : undefined}
                  onChange={update("whyNow")}
                  onBlur={blur("whyNow")}
                  maxLength={500}
                />

                {/* Honeypot — hidden from real users, catches naive bots. */}
                <div style={{ position: "absolute", left: "-9999px", top: "-9999px" }} aria-hidden="true">
                  <label>
                    Website
                    <input
                      type="text"
                      tabIndex={-1}
                      autoComplete="off"
                      value={values.website}
                      onChange={update("website")}
                    />
                  </label>
                </div>

                {submit.isError && (
                  <div
                    role="alert"
                    className="text-[13px] text-[#B42318] bg-[#FEF3F2] border border-[#FECDCA] rounded-lg px-3.5 py-2.5"
                  >
                    {getErrorMessage(submit.error)}
                  </div>
                )}

                <div className="pt-2 flex items-center gap-3">
                  <button
                    type="submit"
                    disabled={submit.isPending}
                    className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full text-[14px] font-medium text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent-ring)] transition-opacity hover:opacity-95 disabled:opacity-60 disabled:cursor-not-allowed"
                    style={{
                      background:
                        "linear-gradient(120deg, #8A6CFF 0%, #6C47FF 55%, #DB2777 100%)",
                    }}
                  >
                    {submit.isPending ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        Sending…
                      </>
                    ) : (
                      "Apply"
                    )}
                  </button>
                  <span className="text-[12.5px] text-[var(--color-text-muted)]">
                    We'll reply within 48 hours.
                  </span>
                </div>
              </form>
            </motion.div>
          )}
        </div>
      </main>
    </div>
  );
}

function SuccessState({ email }: { email: string }) {
  return (
    <div className="text-center py-16">
      <div className="mx-auto inline-flex items-center justify-center w-12 h-12 rounded-full bg-[#ECFDF3] text-[#0E8A4F]">
        <CheckCircle2 className="w-6 h-6" />
      </div>
      <h2
        className="mt-5 text-[28px] font-semibold text-[var(--color-text-primary)] leading-tight"
        style={{ fontFamily: "var(--font-heading)", letterSpacing: "-0.02em" }}
      >
        Application received
      </h2>
      <p
        className="mt-3 text-[14.5px] leading-[1.65] text-[var(--color-text-secondary)] max-w-[520px] mx-auto"
        style={{ fontFamily: "var(--font-sans)" }}
      >
        Thanks — we'll review and reach out at{" "}
        <span className="text-[var(--color-text-primary)] font-medium">{email}</span>{" "}
        within 48 hours. If you don't hear from us, check your spam folder or
        email <a className="underline" href="mailto:arjunhn57@gmail.com">arjunhn57@gmail.com</a>.
      </p>
      <Link
        to="/"
        className="mt-6 inline-flex items-center gap-2 text-[13px] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
      >
        <ArrowLeft className="w-3.5 h-3.5" />
        Back to home
      </Link>
    </div>
  );
}

// ── Form validation ────────────────────────────────────────────────────────

function validate(v: FormState): Partial<Record<keyof FormState, string>> {
  const errors: Partial<Record<keyof FormState, string>> = {};
  if (!v.name.trim()) errors.name = "Required.";
  if (!v.email.trim()) errors.email = "Required.";
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email.trim()))
    errors.email = "Enter a valid email.";
  if (!v.appName.trim()) errors.appName = "Required.";
  if (v.playStoreUrl.trim() && !/^https?:\/\//i.test(v.playStoreUrl.trim()))
    errors.playStoreUrl = "URL must start with http(s)://";
  if (v.whyNow.length > 500) errors.whyNow = "Keep it under 500 characters.";
  return errors;
}

// ── Field primitives ───────────────────────────────────────────────────────

interface FieldProps {
  label: string;
  name: string;
  type?: string;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onBlur?: () => void;
  required?: boolean;
  error?: string;
  hint?: string;
  autoComplete?: string;
  placeholder?: string;
}

function Field({
  label,
  name,
  type = "text",
  value,
  onChange,
  onBlur,
  required,
  error,
  hint,
  autoComplete,
  placeholder,
}: FieldProps) {
  return (
    <div>
      <label
        htmlFor={name}
        className="block text-[12px] font-semibold uppercase tracking-[0.14em] text-[var(--color-text-secondary)]"
        style={{ fontFamily: "var(--font-label)" }}
      >
        {label}
        {required && <span className="text-[var(--color-accent)] ml-1">*</span>}
      </label>
      <input
        id={name}
        name={name}
        type={type}
        value={value}
        onChange={onChange}
        onBlur={onBlur}
        required={required}
        autoComplete={autoComplete}
        placeholder={placeholder}
        aria-invalid={error ? "true" : undefined}
        className="mt-1.5 w-full rounded-lg border border-[var(--color-border-default)] bg-white px-3.5 py-2.5 text-[14px] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent-ring)] transition-colors"
      />
      {error ? (
        <p className="mt-1.5 text-[12.5px] text-[#B42318]">{error}</p>
      ) : hint ? (
        <p className="mt-1.5 text-[12.5px] text-[var(--color-text-muted)]">{hint}</p>
      ) : null}
    </div>
  );
}

interface TextareaFieldProps {
  label: string;
  name: string;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  onBlur?: () => void;
  error?: string;
  hint?: string;
  maxLength?: number;
}

function TextareaField({
  label,
  name,
  value,
  onChange,
  onBlur,
  error,
  hint,
  maxLength,
}: TextareaFieldProps) {
  return (
    <div>
      <label
        htmlFor={name}
        className="block text-[12px] font-semibold uppercase tracking-[0.14em] text-[var(--color-text-secondary)]"
        style={{ fontFamily: "var(--font-label)" }}
      >
        {label}
      </label>
      <textarea
        id={name}
        name={name}
        rows={3}
        value={value}
        onChange={onChange}
        onBlur={onBlur}
        maxLength={maxLength}
        aria-invalid={error ? "true" : undefined}
        className="mt-1.5 w-full rounded-lg border border-[var(--color-border-default)] bg-white px-3.5 py-2.5 text-[14px] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent-ring)] transition-colors resize-none"
      />
      <div className="mt-1.5 flex items-center justify-between gap-2">
        {error ? (
          <p className="text-[12.5px] text-[#B42318]">{error}</p>
        ) : hint ? (
          <p className="text-[12.5px] text-[var(--color-text-muted)]">{hint}</p>
        ) : <span />}
        {maxLength && (
          <span className="text-[11.5px] text-[var(--color-text-muted)] tabular-nums">
            {value.length}/{maxLength}
          </span>
        )}
      </div>
    </div>
  );
}
