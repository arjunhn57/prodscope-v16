import { motion, useReducedMotion } from "framer-motion";
import { Box, Check, X, RotateCcw, AlertTriangle } from "lucide-react";
import type { UploadProgress, UploadState } from "../useUploadJob";
import { EDITORIAL_EASE, REPORT_GRADIENTS } from "../../report/tokens";
import { formatBytes, formatEta } from "../validation";
import { UploadProgressRing } from "./UploadProgressRing";

interface FilePreviewCardProps {
  file: File;
  state: UploadState;
  progress: UploadProgress;
  error: string | null;
  onCancel: () => void;
  onRetry: () => void;
  onReplace: () => void;
}

export function FilePreviewCard({
  file,
  state,
  progress,
  error,
  onCancel,
  onRetry,
  onReplace,
}: FilePreviewCardProps) {
  const reduceMotion = useReducedMotion();
  const isError = state === "error";
  const isComplete = state === "complete";
  const isUploading = state === "uploading";

  const ringTone = isError ? "error" : isComplete ? "success" : "progress";
  const speedDisplay =
    isUploading && progress.speedBps > 0
      ? `${formatBytes(progress.speedBps)}/s`
      : isComplete
        ? "Upload complete"
        : isError
          ? "Failed"
          : "Preparing…";
  const etaDisplay =
    isUploading && progress.etaSec > 0 && progress.speedBps > 0
      ? `${formatEta(progress.etaSec)} remaining`
      : null;

  const borderColor = isError
    ? "rgba(239,68,68,0.45)"
    : isComplete
      ? "rgba(16,185,129,0.45)"
      : "rgba(108,71,255,0.32)";

  return (
    <motion.div
      layout={!reduceMotion}
      initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: EDITORIAL_EASE }}
      className="relative w-full rounded-[28px] p-6 md:p-8"
      style={{
        background: REPORT_GRADIENTS.auroraTile,
        boxShadow:
          "0 2px 6px rgba(15,23,42,0.06), 0 28px 56px -24px rgba(108,71,255,0.22)",
        border: `2px solid ${borderColor}`,
      }}
      aria-live="polite"
    >
      <button
        type="button"
        onClick={isUploading ? onCancel : onReplace}
        aria-label={isUploading ? "Cancel upload" : "Replace file"}
        className="absolute top-4 right-4 z-10 inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11.5px] font-medium text-[var(--color-text-secondary)] bg-white/80 backdrop-blur border border-[var(--color-border-default)] hover:border-[var(--color-border-hover)] hover:text-[var(--color-text-primary)] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent-ring)]"
        style={{ fontFamily: "var(--font-sans)" }}
      >
        <X className="w-3 h-3" />
        {isUploading ? "Cancel" : "Replace"}
      </button>

      <div className="flex flex-col md:flex-row items-start md:items-center gap-6 md:gap-8">
        <div className="shrink-0">
          <UploadProgressRing
            percent={progress.percent}
            size={112}
            strokeWidth={4}
            tone={ringTone}
            label={
              isError
                ? `Upload failed at ${Math.round(progress.percent)} percent`
                : isComplete
                  ? "Upload complete"
                  : `Uploading APK — ${Math.round(progress.percent)} percent`
            }
          >
            <div
              className="w-16 h-16 rounded-[18px] flex items-center justify-center"
              style={{
                background: isError
                  ? "linear-gradient(135deg, #FEE2E2 0%, #FECACA 100%)"
                  : isComplete
                    ? "linear-gradient(135deg, #D1FAE5 0%, #A7F3D0 100%)"
                    : REPORT_GRADIENTS.scoreTrack,
                boxShadow: "0 8px 24px -12px rgba(108,71,255,0.35)",
              }}
            >
              {isError ? (
                <AlertTriangle className="w-7 h-7 text-[#B91C1C]" />
              ) : isComplete ? (
                <Check className="w-7 h-7 text-[#047857]" strokeWidth={2.5} />
              ) : (
                <Box className="w-7 h-7 text-white" strokeWidth={2} />
              )}
            </div>
          </UploadProgressRing>
        </div>

        <div className="flex-1 min-w-0">
          <div
            className="text-[10.5px] font-semibold uppercase tracking-[0.22em] text-[var(--color-text-muted)]"
            style={{ fontFamily: "var(--font-label)" }}
          >
            {isError ? "Upload failed" : isComplete ? "Ready to analyze" : "Uploading APK"}
          </div>

          <div
            className="mt-1.5 text-[19px] md:text-[22px] font-semibold text-[var(--color-text-primary)] leading-tight truncate"
            style={{ fontFamily: "var(--font-mono)", letterSpacing: "-0.005em" }}
            title={file.name}
          >
            {file.name}
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px] text-[var(--color-text-secondary)]">
            <span style={{ fontFamily: "var(--font-mono)" }}>
              {formatBytes(file.size)}
            </span>
            <span className="text-[var(--color-border-hover)]">·</span>
            <span
              className={
                isError
                  ? "text-[#B91C1C]"
                  : isComplete
                    ? "text-[#047857]"
                    : "text-[var(--color-text-secondary)]"
              }
              style={{ fontFamily: "var(--font-mono)" }}
            >
              {speedDisplay}
            </span>
            {etaDisplay && (
              <>
                <span className="text-[var(--color-border-hover)]">·</span>
                <span style={{ fontFamily: "var(--font-mono)" }}>{etaDisplay}</span>
              </>
            )}
          </div>

          <div className="mt-3 flex items-center gap-3">
            <div
              className="flex-1 h-1.5 rounded-full overflow-hidden"
              style={{ background: "rgba(226,232,240,0.9)" }}
            >
              <motion.div
                className="h-full rounded-full"
                style={{
                  background: isError
                    ? "linear-gradient(90deg, #EF4444, #F59E0B)"
                    : isComplete
                      ? "linear-gradient(90deg, #10B981, #14B8A6)"
                      : REPORT_GRADIENTS.scoreTrack,
                }}
                initial={{ width: 0 }}
                animate={{ width: `${progress.percent}%` }}
                transition={
                  reduceMotion
                    ? { duration: 0 }
                    : { duration: 0.3, ease: EDITORIAL_EASE }
                }
              />
            </div>
            <div
              className="text-[12.5px] font-semibold text-[var(--color-text-primary)] tabular-nums min-w-[44px] text-right"
              style={{ fontFamily: "var(--font-mono)" }}
            >
              {Math.round(progress.percent)}%
            </div>
          </div>

          {isError && error && (
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <div
                className="text-[12.5px] text-[#B91C1C]"
                style={{ fontFamily: "var(--font-sans)" }}
              >
                {error}
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={onRetry}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] font-medium text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent-ring)] transition-opacity hover:opacity-95"
                  style={{ background: REPORT_GRADIENTS.hero }}
                >
                  <RotateCcw className="w-3 h-3" />
                  Try again
                </button>
                <button
                  type="button"
                  onClick={onReplace}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] font-medium text-[var(--color-text-secondary)] bg-white border border-[var(--color-border-default)] hover:border-[var(--color-border-hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent-ring)] transition-colors"
                >
                  Replace file
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}
