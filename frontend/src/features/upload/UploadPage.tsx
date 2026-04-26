import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion, useReducedMotion, AnimatePresence } from "framer-motion";
import { ArrowLeft, Upload, Link as LinkIcon, Info } from "lucide-react";
import { TopBar } from "../../components/layout/TopBar";
import { Dropzone } from "./components/Dropzone";
import { FilePreviewCard } from "./components/FilePreviewCard";
import { MetadataPanel } from "./components/MetadataPanel";
import { TrustStrip } from "./components/TrustStrip";
import { LaunchCTA } from "./components/LaunchCTA";
import { useUploadJob, type UploadMeta } from "./useUploadJob";
import { EDITORIAL_EASE } from "../report/tokens";

// Match canonical Play Store URLs (with/without locale prefix and extra
// query params). The id= parameter is the Android package name we extract
// server-side.
const PLAY_STORE_URL_REGEX =
  /^https?:\/\/(www\.)?play\.google\.com\/store\/apps\/details\?(?:[^#]*&)?id=[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)+/i;

function isValidPlayStoreUrl(s: string): boolean {
  return PLAY_STORE_URL_REGEX.test(s.trim());
}

type InputMode = "upload" | "url";

const AURORA_BACKDROP =
  "radial-gradient(80% 50% at 50% 0%, rgba(108,71,255,0.08) 0%, rgba(108,71,255,0) 55%), radial-gradient(60% 50% at 50% 0%, rgba(219,39,119,0.05) 0%, rgba(219,39,119,0) 60%), #FAFAFA";

export function UploadPage() {
  const navigate = useNavigate();
  const reduceMotion = useReducedMotion();

  const [inputMode, setInputMode] = useState<InputMode>("upload");
  const [file, setFile] = useState<File | null>(null);
  const [playStoreUrl, setPlayStoreUrl] = useState<string>("");
  const [urlTouched, setUrlTouched] = useState(false);
  const [meta, setMeta] = useState<UploadMeta>({});
  const [submitting, setSubmitting] = useState(false);
  const [fadingOut, setFadingOut] = useState(false);

  const upload = useUploadJob();
  const urlValid = !playStoreUrl || isValidPlayStoreUrl(playStoreUrl);

  const handleFileAccepted = useCallback(
    (accepted: File) => {
      upload.reset();
      setFile(accepted);
    },
    [upload]
  );

  const handleCancel = useCallback(() => {
    upload.cancel();
    setFile(null);
  }, [upload]);

  const handleReplace = useCallback(() => {
    upload.reset();
    setFile(null);
  }, [upload]);

  const handleRetry = useCallback(() => {
    if (inputMode === "url") {
      if (!isValidPlayStoreUrl(playStoreUrl)) return;
      upload.startFromUrl(playStoreUrl, meta);
      return;
    }
    if (!file) return;
    upload.startUpload(file, meta);
  }, [file, meta, upload, inputMode, playStoreUrl]);

  const handleLaunch = useCallback(() => {
    if (upload.state === "uploading" || submitting) return;
    if (upload.state !== "idle" && upload.state !== "error") return;
    if (inputMode === "url") {
      if (!isValidPlayStoreUrl(playStoreUrl)) {
        setUrlTouched(true);
        return;
      }
      setSubmitting(true);
      upload.startFromUrl(playStoreUrl, meta);
      return;
    }
    if (!file) return;
    setSubmitting(true);
    upload.startUpload(file, meta);
  }, [file, meta, upload, submitting, inputMode, playStoreUrl]);

  useEffect(() => {
    if (upload.state === "error") {
      setSubmitting(false);
      return;
    }
    if (upload.state !== "complete" || !upload.result?.jobId) return;
    const jobId = upload.result.jobId;
    const fadeDelay = reduceMotion ? 0 : 180;
    const navDelay = reduceMotion ? 0 : 320;
    let navTimer: ReturnType<typeof setTimeout> | undefined;
    const fadeTimer = setTimeout(() => {
      setFadingOut(true);
      navTimer = setTimeout(() => navigate(`/run/${jobId}`), navDelay);
    }, fadeDelay);
    return () => {
      clearTimeout(fadeTimer);
      if (navTimer) clearTimeout(navTimer);
    };
  }, [upload.state, upload.result, navigate, reduceMotion]);

  const ctaHint = (() => {
    if (upload.state === "complete") return "Your analysis is queued and ready to start.";
    if (upload.state === "uploading") {
      return inputMode === "url"
        ? "Fetching APK from the Play Store mirror — this can take a minute."
        : "Uploading your APK — hang tight.";
    }
    if (upload.state === "error") return "Resolve the error below before launching.";
    if (inputMode === "url") {
      if (!playStoreUrl) return "Paste a Play Store URL to enable launch.";
      if (!urlValid) return "Enter a valid Play Store URL to enable launch.";
      return "Add context below if needed, then launch when you're ready.";
    }
    if (file) return "Add context below if needed, then launch when you're ready.";
    return "Drop an APK above to enable launch.";
  })();

  const launchReady =
    upload.state !== "uploading" &&
    !submitting &&
    (inputMode === "url" ? isValidPlayStoreUrl(playStoreUrl) : !!file);

  return (
    <div className="flex flex-col min-h-dvh">
      <TopBar title="New Analysis" />

      <motion.div
        animate={{ opacity: fadingOut ? 0 : 1 }}
        transition={{ duration: reduceMotion ? 0 : 0.32, ease: EDITORIAL_EASE }}
        className="flex-1 relative"
        style={{ background: AURORA_BACKDROP }}
      >
        <div className="mx-auto max-w-[960px] px-4 sm:px-6 lg:px-10 py-8 md:py-14">
          <button
            type="button"
            onClick={() => navigate("/dashboard")}
            className="inline-flex items-center gap-2 text-[12.5px] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent-ring)] rounded"
            style={{ fontFamily: "var(--font-sans)" }}
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Back to dashboard
          </button>

          <motion.header
            initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: EDITORIAL_EASE }}
            className="mt-6 md:mt-8 text-center"
          >
            <div
              className="text-[10.5px] font-semibold uppercase tracking-[0.24em] text-[var(--color-text-muted)]"
              style={{ fontFamily: "var(--font-label)" }}
            >
              ProdScope · Intelligence Pipeline
            </div>
            <h1
              className="mt-4 text-[38px] sm:text-[48px] md:text-[58px] font-semibold text-[var(--color-text-primary)] leading-[1.04] max-w-[780px] mx-auto"
              style={{ fontFamily: "var(--font-heading)", letterSpacing: "-0.025em" }}
            >
              Upload your APK.
              <br />
              <span
                className="bg-clip-text text-transparent"
                style={{
                  backgroundImage:
                    "linear-gradient(120deg, #6C47FF 0%, #8A6CFF 45%, #DB2777 100%)",
                }}
              >
                We&rsquo;ll analyze it.
              </span>
            </h1>
            <p
              className="mt-5 text-[15.5px] md:text-[17px] text-[var(--color-text-secondary)] leading-[1.65] max-w-[620px] mx-auto"
              style={{ fontFamily: "var(--font-sans)" }}
            >
              Drop an Android build. We'll capture every screen, surface findings with annotated
              proof, and email you a diligence-grade report in 5–8 minutes.
            </p>

            {/* Phase D3: expectation-setting strip + sample link.
                Sets concrete promises (delivered to inbox, in 5-8 min,
                annotated screenshots) and offers a sample report so the
                user can see the deliverable before uploading. */}
            <div className="mt-7 flex flex-wrap items-center justify-center gap-x-5 gap-y-2.5">
              <ExpectationPill label="Delivered in" value="5–8 min" />
              <ExpectationPill label="Captured" value="30+ screens" />
              <ExpectationPill label="Proof" value="annotated screenshots" />
              <a
                href="/sample"
                className="inline-flex items-center gap-1.5 text-[13px] font-medium text-[var(--color-report-accent)] hover:opacity-80 transition-opacity focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-report-accent-ring)] rounded"
                style={{ fontFamily: "var(--font-sans)" }}
              >
                See a sample report
                <svg
                  className="w-3 h-3"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden
                >
                  <path d="M5 12h14M13 6l6 6-6 6" />
                </svg>
              </a>
            </div>
          </motion.header>

          <motion.section
            initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: EDITORIAL_EASE, delay: reduceMotion ? 0 : 0.08 }}
            className="mt-10 md:mt-14"
          >
            {/* 2026-04-26 (Item #3): input mode toggle — APK upload vs Play
                Store URL paste. State: inputMode. The upload panel keeps the
                existing Dropzone+Preview flow; the url panel posts JSON to
                /api/v1/start-job-from-url which fetches the APK server-side
                via lib/apk-fetcher. */}
            <div
              className="mx-auto max-w-[520px] mb-5 flex gap-1.5 rounded-xl p-1"
              style={{
                background: "rgba(241,245,249,0.8)",
                border: "1px solid rgba(226,232,240,0.9)",
              }}
              role="tablist"
              aria-label="Choose input source"
            >
              <button
                type="button"
                role="tab"
                aria-selected={inputMode === "upload"}
                onClick={() => setInputMode("upload")}
                disabled={upload.state === "uploading" || submitting}
                className="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-[13px] font-semibold transition-all disabled:cursor-not-allowed"
                style={{
                  background: inputMode === "upload" ? "white" : "transparent",
                  color:
                    inputMode === "upload"
                      ? "var(--color-text-primary)"
                      : "var(--color-text-muted)",
                  boxShadow:
                    inputMode === "upload"
                      ? "0 1px 2px rgba(15,23,42,0.06)"
                      : "none",
                  fontFamily: "var(--font-label)",
                }}
              >
                <Upload className="w-3.5 h-3.5" />
                Upload APK
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={inputMode === "url"}
                onClick={() => setInputMode("url")}
                disabled={upload.state === "uploading" || submitting}
                className="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-[13px] font-semibold transition-all disabled:cursor-not-allowed"
                style={{
                  background: inputMode === "url" ? "white" : "transparent",
                  color:
                    inputMode === "url"
                      ? "var(--color-text-primary)"
                      : "var(--color-text-muted)",
                  boxShadow:
                    inputMode === "url" ? "0 1px 2px rgba(15,23,42,0.06)" : "none",
                  fontFamily: "var(--font-label)",
                }}
              >
                <LinkIcon className="w-3.5 h-3.5" />
                Paste Play Store URL
              </button>
            </div>

            <AnimatePresence mode="wait">
              {inputMode === "upload" ? (
                file ? (
                  <motion.div
                    key="preview"
                    initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -8 }}
                    transition={{ duration: 0.35, ease: EDITORIAL_EASE }}
                  >
                    <FilePreviewCard
                      file={file}
                      state={upload.state}
                      progress={upload.progress}
                      error={upload.error}
                      onCancel={handleCancel}
                      onReplace={handleReplace}
                      onRetry={handleRetry}
                    />
                  </motion.div>
                ) : (
                  <motion.div
                    key="dropzone"
                    initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -8 }}
                    transition={{ duration: 0.35, ease: EDITORIAL_EASE }}
                  >
                    <Dropzone onFileAccepted={handleFileAccepted} />
                  </motion.div>
                )
              ) : (
                <motion.div
                  key="url-panel"
                  initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -8 }}
                  transition={{ duration: 0.35, ease: EDITORIAL_EASE }}
                  className="mx-auto max-w-[640px]"
                >
                  <div
                    className="rounded-2xl p-5 md:p-6"
                    style={{
                      background:
                        "linear-gradient(180deg, rgba(255,255,255,0.95) 0%, rgba(248,250,252,0.9) 100%)",
                      border: "1px solid rgba(226,232,240,0.9)",
                      boxShadow:
                        "0 1px 2px rgba(15,23,42,0.04), 0 14px 32px -20px rgba(15,23,42,0.16)",
                    }}
                  >
                    <label
                      htmlFor="playStoreUrlInput"
                      className="block text-[12.5px] font-semibold text-[var(--color-text-primary)] mb-2"
                      style={{ fontFamily: "var(--font-label)" }}
                    >
                      Play Store URL
                    </label>
                    <input
                      id="playStoreUrlInput"
                      type="url"
                      inputMode="url"
                      autoComplete="off"
                      spellCheck={false}
                      value={playStoreUrl}
                      onChange={(e) => {
                        setPlayStoreUrl(e.target.value);
                        if (urlTouched) setUrlTouched(false);
                      }}
                      onBlur={() => setUrlTouched(true)}
                      placeholder="https://play.google.com/store/apps/details?id=com.example.app"
                      disabled={upload.state === "uploading" || submitting}
                      className="w-full rounded-xl border bg-white px-3.5 py-2.5 text-[14px] text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-ring)] disabled:opacity-60 disabled:cursor-not-allowed"
                      style={{
                        borderColor:
                          urlTouched && !urlValid
                            ? "rgb(239,68,68)"
                            : "rgba(226,232,240,1)",
                        fontFamily: "var(--font-mono, monospace)",
                      }}
                      aria-invalid={urlTouched && !urlValid ? true : undefined}
                      aria-describedby="playStoreUrlHint"
                    />
                    <div
                      id="playStoreUrlHint"
                      className="mt-2.5 flex items-start gap-1.5 text-[12px] text-[var(--color-text-muted)] leading-[1.5]"
                      style={{ fontFamily: "var(--font-sans)" }}
                    >
                      <Info className="w-3.5 h-3.5 mt-[1px] shrink-0" />
                      <span>
                        We fetch the public APK from a public mirror — never
                        sign in to Google Play on your behalf. If the mirror
                        doesn&rsquo;t have this app, switch to direct upload.
                      </span>
                    </div>
                    {urlTouched && playStoreUrl && !urlValid && (
                      <div
                        className="mt-2 text-[12px] text-[rgb(220,38,38)]"
                        style={{ fontFamily: "var(--font-sans)" }}
                      >
                        Doesn&rsquo;t look like a Play Store app URL. Expected:
                        https://play.google.com/store/apps/details?id=...
                      </div>
                    )}
                    {upload.state === "error" && upload.error && (
                      <div
                        className="mt-3 rounded-lg border border-[rgba(220,38,38,0.2)] bg-[rgba(254,226,226,0.4)] px-3 py-2 text-[12.5px] text-[rgb(159,18,57)]"
                        style={{ fontFamily: "var(--font-sans)" }}
                      >
                        {upload.error}
                      </div>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.section>

          <motion.section
            initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 10 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-60px" }}
            transition={{ duration: 0.45, ease: EDITORIAL_EASE, delay: reduceMotion ? 0 : 0.05 }}
            className="mt-6 md:mt-8"
          >
            <TrustStrip />
          </motion.section>

          <motion.section
            initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 10 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-60px" }}
            transition={{ duration: 0.45, ease: EDITORIAL_EASE, delay: reduceMotion ? 0 : 0.1 }}
            className="mt-8 md:mt-10 flex justify-center"
          >
            <MetadataPanel
              value={meta}
              onChange={setMeta}
              disabled={upload.state === "uploading" || submitting}
            />
          </motion.section>

          <motion.section
            initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 10 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-60px" }}
            transition={{ duration: 0.45, ease: EDITORIAL_EASE, delay: reduceMotion ? 0 : 0.15 }}
            className="mt-10 md:mt-12 flex justify-center"
          >
            <LaunchCTA
              ready={launchReady}
              submitting={submitting && upload.state !== "uploading"}
              uploading={upload.state === "uploading"}
              onClick={handleLaunch}
              hint={ctaHint}
            />
          </motion.section>

          <div className="h-24 md:h-32" />
        </div>
      </motion.div>
    </div>
  );
}

interface ExpectationPillProps {
  label: string;
  value: string;
}

function ExpectationPill({ label, value }: ExpectationPillProps) {
  return (
    <span
      className="inline-flex items-center gap-1.5 text-[12px] text-[var(--color-text-secondary)]"
      style={{ fontFamily: "var(--font-sans)" }}
    >
      <span
        className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--color-text-muted)]"
        style={{ fontFamily: "var(--font-label)" }}
      >
        {label}
      </span>
      <span className="font-semibold text-[var(--color-text-primary)]">
        {value}
      </span>
    </span>
  );
}
