import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { OverlayCanvas, type PerceptionBox, type TapTarget } from "./OverlayCanvas";

interface PhoneStreamProps {
  streamUrl: string;
  boxes: PerceptionBox[];
  tapTarget: TapTarget | null;
  stage: "awareness" | "decision" | "action" | "idle";
  actionKey: string | number | null;
  reasoning: string | null;
  expectedOutcome: string | null;
  fallbackCaption: string | null;
  isTerminal?: boolean;
  placeholderLabel?: string;
}

const EMULATOR_W = 1080;
const EMULATOR_H = 2340;

export function PhoneStream({
  streamUrl,
  boxes,
  tapTarget,
  stage,
  actionKey,
  reasoning,
  expectedOutcome,
  fallbackCaption,
  isTerminal,
  placeholderLabel,
}: PhoneStreamProps) {
  const screenRef = useRef<HTMLDivElement | null>(null);
  const [dims, setDims] = useState<{ w: number; h: number }>({ w: 0, h: 0 });

  useLayoutEffect(() => {
    const el = screenRef.current;
    if (!el) return;
    const update = () => {
      const rect = el.getBoundingClientRect();
      setDims({ w: rect.width, h: rect.height });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    window.addEventListener("resize", update);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", update);
    };
  }, []);

  const [imgLoaded, setImgLoaded] = useState(false);
  useEffect(() => {
    setImgLoaded(false);
  }, [streamUrl]);

  const [bootTick, setBootTick] = useState(0);
  useEffect(() => {
    if (imgLoaded || isTerminal) return;
    const id = window.setInterval(() => setBootTick((t) => t + 1), 2400);
    return () => window.clearInterval(id);
  }, [imgLoaded, isTerminal]);
  const BOOT_PHASES = [
    "Acquiring device",
    "Launching emulator",
    "Installing package",
    "Waiting for first frame",
  ];
  const bootSub = BOOT_PHASES[Math.min(bootTick, BOOT_PHASES.length - 1)];

  const captionLine = isTerminal
    ? ""
    : reasoning?.trim() || fallbackCaption?.trim() || "";
  const captionSub = isTerminal ? "" : expectedOutcome?.trim() || "";

  return (
    <div className="relative mx-auto w-full" style={{ maxWidth: 420 }}>
      <div
        className="pointer-events-none absolute inset-0 -z-10"
        aria-hidden="true"
        style={{
          background: "radial-gradient(closest-side, rgba(108,71,255,0.45), rgba(108,71,255,0) 70%)",
          filter: "blur(72px)",
          transform: "translate(0, 8%) scale(1.1)",
        }}
      />
      <div
        className="relative rounded-[2.6rem] p-[10px] overflow-hidden"
        style={{
          background: "linear-gradient(145deg, #1F2937 0%, #0A0A14 100%)",
          boxShadow:
            "0 40px 80px -20px rgba(0, 0, 0, 0.6), inset 0 1px 0 rgba(255, 255, 255, 0.08), inset 0 0 0 1px rgba(255,255,255,0.04)",
        }}
      >
        <div
          className="absolute top-[14px] left-1/2 -translate-x-1/2 rounded-full z-30"
          style={{ width: 90, height: 22, background: "#05050A", boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.06)" }}
        />
        <div
          ref={screenRef}
          className="relative rounded-[2rem] bg-black overflow-hidden aspect-[9/19.5]"
        >
          {streamUrl && (
            <img
              src={streamUrl}
              alt="Live emulator stream"
              className="absolute inset-0 w-full h-full object-cover"
              style={{ opacity: imgLoaded ? (isTerminal ? 0.4 : 1) : 0.0 }}
              onLoad={() => setImgLoaded(true)}
              onError={() => setImgLoaded(false)}
            />
          )}

          {!imgLoaded && !isTerminal && (
            <div
              className="absolute inset-0 flex items-center justify-center"
              style={{
                background:
                  "radial-gradient(circle at 30% 30%, rgba(76,29,149,0.55), transparent 55%), radial-gradient(circle at 75% 72%, rgba(219,39,119,0.35), transparent 60%), radial-gradient(circle at 50% 90%, rgba(108,71,255,0.28), transparent 55%), #0A0A14",
              }}
            >
              <div className="text-center px-6">
                <motion.div
                  className="mx-auto mb-5 w-12 h-12 rounded-full"
                  style={{
                    background:
                      "conic-gradient(from 0deg, rgba(108,71,255,0.1), rgba(219,39,119,0.7), rgba(108,71,255,0.1))",
                    WebkitMask:
                      "radial-gradient(circle, transparent 55%, black 56%)",
                    mask: "radial-gradient(circle, transparent 55%, black 56%)",
                  }}
                  animate={{ rotate: 360 }}
                  transition={{ duration: 2.8, repeat: Infinity, ease: "linear" }}
                />
                <div
                  className="text-white text-[19px] font-semibold"
                  style={{
                    fontFamily: "var(--font-heading)",
                    letterSpacing: "-0.01em",
                  }}
                >
                  {placeholderLabel || "Booting emulator"}
                </div>
                <AnimatePresence mode="wait">
                  <motion.div
                    key={bootSub}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    transition={{ duration: 0.35, ease: [0.22, 0.61, 0.36, 1] }}
                    className="mt-1.5 text-[12px] text-white/65"
                    style={{ fontFamily: "var(--font-mono)" }}
                  >
                    {bootSub}
                    <motion.span
                      className="inline-block"
                      animate={{ opacity: [0.3, 1, 0.3] }}
                      transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
                    >
                      …
                    </motion.span>
                  </motion.div>
                </AnimatePresence>
              </div>
            </div>
          )}

          {imgLoaded && !isTerminal && (
            <OverlayCanvas
              width={dims.w}
              height={dims.h}
              emulatorWidth={EMULATOR_W}
              emulatorHeight={EMULATOR_H}
              boxes={boxes}
              tapTarget={tapTarget}
              stage={stage}
              actionKey={actionKey}
            />
          )}

          <AnimatePresence mode="wait">
            {captionLine && (
              <motion.div
                key={captionLine}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.28, ease: [0.22, 0.61, 0.36, 1] }}
                className="absolute left-0 right-0 bottom-0 px-4 py-3 z-20"
                style={{
                  background: "linear-gradient(180deg, rgba(10,10,20,0) 0%, rgba(10,10,20,0.78) 55%, rgba(10,10,20,0.94) 100%)",
                  backdropFilter: "blur(18px)",
                  WebkitBackdropFilter: "blur(18px)",
                  borderTop: "1px solid rgba(255,255,255,0.06)",
                }}
                aria-live="polite"
              >
                <div
                  className="text-[13px] leading-snug text-white/95"
                  style={{
                    fontFamily: "var(--font-sans)",
                    fontWeight: 500,
                    display: "-webkit-box",
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: "vertical",
                    overflow: "hidden",
                  }}
                  title={captionLine}
                >
                  {captionLine}
                </div>
                {captionSub && (
                  <div
                    className="mt-1 text-[11px] text-white/60 truncate"
                    style={{ fontFamily: "var(--font-mono)" }}
                    title={captionSub}
                  >
                    → Expecting: {captionSub}
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
