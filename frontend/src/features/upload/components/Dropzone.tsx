import { useCallback, useRef, useState } from "react";
import { motion, useReducedMotion, AnimatePresence } from "framer-motion";
import { Upload, AlertCircle } from "lucide-react";
import { EDITORIAL_EASE } from "../../report/tokens";
import { validateApk, looksLikeApkFromDataTransfer, APK_MIME } from "../validation";

interface DropzoneProps {
  onFileAccepted: (file: File) => void;
  disabled?: boolean;
}

type DragKind = "none" | "valid" | "invalid";

export function Dropzone({ onFileAccepted, disabled = false }: DropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const reduceMotion = useReducedMotion();
  const [drag, setDrag] = useState<DragKind>("none");
  const [validationError, setValidationError] = useState<string | null>(null);
  const dragDepthRef = useRef(0);

  const openPicker = useCallback(() => {
    if (disabled) return;
    inputRef.current?.click();
  }, [disabled]);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openPicker();
      }
    },
    [openPicker]
  );

  const handleFileCandidate = useCallback(
    (file: File | undefined | null) => {
      if (!file) return;
      const result = validateApk(file);
      if (!result.ok) {
        setValidationError(result.reason);
        setDrag("none");
        return;
      }
      setValidationError(null);
      onFileAccepted(file);
    },
    [onFileAccepted]
  );

  const onInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      handleFileCandidate(e.target.files?.[0]);
      e.target.value = "";
    },
    [handleFileCandidate]
  );

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    if (disabled) return;
    e.dataTransfer.dropEffect = "copy";
  }, [disabled]);

  const onDragEnter = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      if (disabled) return;
      dragDepthRef.current += 1;
      setValidationError(null);
      const looksValid = looksLikeApkFromDataTransfer(e.dataTransfer);
      setDrag(looksValid ? "valid" : "invalid");
    },
    [disabled]
  );

  const onDragLeave = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      if (disabled) return;
      dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
      if (dragDepthRef.current === 0) setDrag("none");
    },
    [disabled]
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      if (disabled) return;
      dragDepthRef.current = 0;
      setDrag("none");
      const file = e.dataTransfer.files?.[0];
      handleFileCandidate(file);
    },
    [disabled, handleFileCandidate]
  );

  const isInvalid = drag === "invalid";
  const isValidDrag = drag === "valid";
  const hasValidationError = !!validationError;

  const accentBorder = isInvalid || hasValidationError
    ? "linear-gradient(120deg, #F59E0B 0%, #EF4444 100%)"
    : "linear-gradient(120deg, #8A6CFF 0%, #6C47FF 55%, #DB2777 100%)";

  const borderOpacity = isValidDrag ? 1 : hasValidationError || isInvalid ? 0.9 : 0.52;

  return (
    <div className="relative w-full">
      <motion.div
        layout={!reduceMotion}
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-label="Drop your APK file here or press Enter to browse"
        aria-disabled={disabled}
        onKeyDown={onKeyDown}
        onClick={openPicker}
        onDragOver={onDragOver}
        onDragEnter={onDragEnter}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        animate={
          reduceMotion
            ? undefined
            : isValidDrag
              ? { scale: 1.012 }
              : { scale: 1 }
        }
        transition={{ duration: 0.25, ease: EDITORIAL_EASE }}
        className="relative w-full cursor-pointer rounded-[28px] overflow-hidden focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent-ring)]"
        style={{
          minHeight: "clamp(280px, 42vh, 360px)",
          border: "2px solid transparent",
          backgroundImage: `linear-gradient(180deg, #FFFFFF 0%, #FAF7FF 100%), ${accentBorder}`,
          backgroundOrigin: "border-box",
          backgroundClip: "padding-box, border-box",
          opacity: disabled ? 0.6 : 1,
          boxShadow: isValidDrag
            ? "0 8px 20px rgba(108,71,255,0.18), 0 32px 72px -28px rgba(108,71,255,0.42)"
            : "0 1px 3px rgba(15,23,42,0.04), 0 24px 56px -28px rgba(15,23,42,0.18)",
          transition: "box-shadow 300ms cubic-bezier(0.22, 0.61, 0.36, 1)",
        }}
      >
        {/* Soft aurora wash on the inside (not full bleed) */}
        <div
          aria-hidden
          className="absolute inset-0 pointer-events-none rounded-[26px]"
          style={{
            background:
              "radial-gradient(120% 80% at 50% 100%, rgba(239,235,255,0.55) 0%, rgba(255,255,255,0) 60%)",
            opacity: borderOpacity > 0.8 ? 1 : 0.85,
            transition: "opacity 260ms cubic-bezier(0.22, 0.61, 0.36, 1)",
          }}
        />

        <AnimatePresence>
          {isValidDrag && !reduceMotion && (
            <motion.div
              aria-hidden
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 0.3, ease: EDITORIAL_EASE }}
              className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none"
              style={{
                width: 280,
                height: 280,
                background:
                  "radial-gradient(circle at center, rgba(108,71,255,0.22) 0%, rgba(138,108,255,0.12) 40%, transparent 70%)",
                filter: "blur(6px)",
              }}
            />
          )}
        </AnimatePresence>

        <div className="relative flex flex-col items-center justify-center gap-5 px-6 py-10 md:py-14 text-center h-full min-h-[inherit]">
          <motion.div
            animate={
              reduceMotion
                ? undefined
                : isValidDrag
                  ? { y: -4, scale: 1.04 }
                  : { y: 0, scale: 1 }
            }
            transition={{ duration: 0.3, ease: EDITORIAL_EASE }}
            className="flex items-center justify-center"
          >
            <div
              className="w-16 h-16 md:w-[72px] md:h-[72px] rounded-[20px] flex items-center justify-center"
              style={{
                background: isInvalid || hasValidationError
                  ? "linear-gradient(135deg, #FEE2E2 0%, #FED7AA 100%)"
                  : "linear-gradient(135deg, rgba(138,108,255,0.18) 0%, rgba(108,71,255,0.28) 100%)",
                boxShadow: "inset 0 1px 0 rgba(255,255,255,0.6)",
              }}
            >
              {isInvalid || hasValidationError ? (
                <AlertCircle className="w-7 h-7 text-[#B45309]" strokeWidth={2} />
              ) : (
                <Upload className="w-7 h-7 text-[var(--color-accent)]" strokeWidth={2} />
              )}
            </div>
          </motion.div>

          <div className="flex flex-col items-center gap-1.5 max-w-[520px]">
            <AnimatePresence mode="wait">
              <motion.div
                key={
                  hasValidationError
                    ? "err"
                    : isInvalid
                      ? "invalid"
                      : isValidDrag
                        ? "release"
                        : "idle"
                }
                initial={reduceMotion ? undefined : { opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={reduceMotion ? undefined : { opacity: 0, y: -4 }}
                transition={{ duration: 0.2, ease: EDITORIAL_EASE }}
                className="text-[20px] md:text-[22px] font-semibold text-[var(--color-text-primary)] leading-tight"
                style={{ fontFamily: "var(--font-heading)", letterSpacing: "-0.015em" }}
              >
                {hasValidationError
                  ? validationError
                  : isInvalid
                    ? "APK files only"
                    : isValidDrag
                      ? "Release to analyze"
                      : "Drop APK to analyze"}
              </motion.div>
            </AnimatePresence>

            <div
              className="text-[13.5px] text-[var(--color-text-secondary)]"
              style={{ fontFamily: "var(--font-sans)" }}
            >
              or click to browse · Max 200MB · .apk
            </div>
          </div>

          <div
            className="mt-1 text-[10.5px] font-semibold uppercase tracking-[0.22em] text-[var(--color-text-muted)]"
            style={{ fontFamily: "var(--font-label)" }}
          >
            Android package · Encrypted upload
          </div>
        </div>

        <input
          ref={inputRef}
          type="file"
          accept={`.apk,${APK_MIME}`}
          className="hidden"
          onChange={onInputChange}
          disabled={disabled}
        />
      </motion.div>

      <AnimatePresence>
        {validationError && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.2, ease: EDITORIAL_EASE }}
            role="alert"
            className="mt-3 inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-[12px] font-medium"
            style={{
              background: "rgba(245,158,11,0.1)",
              color: "#B45309",
              border: "1px solid rgba(245,158,11,0.3)",
              fontFamily: "var(--font-sans)",
            }}
          >
            <AlertCircle className="w-3.5 h-3.5" />
            {validationError}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
