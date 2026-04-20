import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion, useReducedMotion, AnimatePresence } from "framer-motion";
import { ArrowLeft } from "lucide-react";
import { TopBar } from "../../components/layout/TopBar";
import { Dropzone } from "./components/Dropzone";
import { FilePreviewCard } from "./components/FilePreviewCard";
import { MetadataPanel } from "./components/MetadataPanel";
import { TrustStrip } from "./components/TrustStrip";
import { LaunchCTA } from "./components/LaunchCTA";
import { useUploadJob, type UploadMeta } from "./useUploadJob";
import { EDITORIAL_EASE } from "../report/tokens";

const AURORA_BACKDROP =
  "radial-gradient(80% 50% at 50% 0%, rgba(108,71,255,0.08) 0%, rgba(108,71,255,0) 55%), radial-gradient(60% 50% at 50% 0%, rgba(219,39,119,0.05) 0%, rgba(219,39,119,0) 60%), #FAFAFA";

export function UploadPage() {
  const navigate = useNavigate();
  const reduceMotion = useReducedMotion();

  const [file, setFile] = useState<File | null>(null);
  const [meta, setMeta] = useState<UploadMeta>({});
  const [submitting, setSubmitting] = useState(false);
  const [fadingOut, setFadingOut] = useState(false);

  const upload = useUploadJob();

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
    if (!file) return;
    upload.startUpload(file, meta);
  }, [file, meta, upload]);

  const handleLaunch = useCallback(() => {
    if (!file) return;
    if (upload.state === "idle" || upload.state === "error") {
      setSubmitting(true);
      upload.startUpload(file, meta);
      return;
    }
    if (upload.state === "complete" && upload.result?.jobId) {
      setSubmitting(true);
      const jobId = upload.result.jobId;
      setTimeout(
        () => {
          setFadingOut(true);
          setTimeout(() => navigate(`/run/${jobId}`), reduceMotion ? 0 : 320);
        },
        reduceMotion ? 0 : 180
      );
    }
  }, [file, meta, upload, navigate, reduceMotion]);

  useEffect(() => {
    if (upload.state === "uploading" || upload.state === "idle") return;
    if (upload.state === "error") setSubmitting(false);
  }, [upload.state]);

  const ctaHint = (() => {
    if (upload.state === "complete") return "Your analysis is queued and ready to start.";
    if (upload.state === "uploading") return "Uploading your APK — hang tight.";
    if (upload.state === "error") return "Resolve the upload error before launching.";
    if (file) return "Add context below if needed, then launch when you're ready.";
    return "Drop an APK above to enable launch.";
  })();

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
              Drop an Android build. Get a premium intelligence report in minutes — screens mapped,
              flows graded, blockers surfaced.
            </p>
          </motion.header>

          <motion.section
            initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: EDITORIAL_EASE, delay: reduceMotion ? 0 : 0.08 }}
            className="mt-10 md:mt-14"
          >
            <AnimatePresence mode="wait">
              {file ? (
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
              ready={!!file && upload.state !== "uploading"}
              submitting={submitting || upload.state === "uploading"}
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
