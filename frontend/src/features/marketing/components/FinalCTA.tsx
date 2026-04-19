import { useRef, useState } from "react";
import {
  AnimatePresence,
  motion,
  useMotionValue,
  useMotionTemplate,
  useSpring,
  useReducedMotion,
} from "framer-motion";
import { ArrowRight } from "lucide-react";
import { useNavigate } from "react-router-dom";

interface Ripple {
  id: number;
  x: number;
  y: number;
}

const EASE_OUT: [number, number, number, number] = [0.22, 1, 0.36, 1];

const GRADIENT_BG =
  "linear-gradient(135deg, #1E1B4B 0%, #312E81 25%, #4C1D95 50%, #581C87 75%, #1E1B4B 100%)";

interface MagneticCTAProps {
  onClick: () => void;
  reduceMotion: boolean;
}

function MagneticCTA({ onClick, reduceMotion }: MagneticCTAProps) {
  const ref = useRef<HTMLButtonElement>(null);
  const mx = useMotionValue(0);
  const my = useMotionValue(0);
  const sx = useSpring(mx, { stiffness: 260, damping: 22, mass: 0.5 });
  const sy = useSpring(my, { stiffness: 260, damping: 22, mass: 0.5 });
  const px = useMotionValue(50);
  const py = useMotionValue(50);
  const shimmerBg = useMotionTemplate`radial-gradient(circle 160px at ${px}% ${py}%, rgba(255,255,255,0.35), transparent 55%)`;
  const [ripples, setRipples] = useState<Ripple[]>([]);

  const onMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (!ref.current) return;
    const r = ref.current.getBoundingClientRect();
    const relX = e.clientX - (r.left + r.width / 2);
    const relY = e.clientY - (r.top + r.height / 2);
    mx.set(relX * 0.15);
    my.set(relY * 0.15);
    px.set(((e.clientX - r.left) / r.width) * 100);
    py.set(((e.clientY - r.top) / r.height) * 100);
  };

  const onLeave = () => {
    mx.set(0);
    my.set(0);
    px.set(50);
    py.set(50);
  };

  const onPressStart = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (!ref.current || reduceMotion) return;
    const r = ref.current.getBoundingClientRect();
    const id = Date.now() + Math.random();
    setRipples((prev) => [
      ...prev,
      { id, x: e.clientX - r.left, y: e.clientY - r.top },
    ]);
    window.setTimeout(
      () => setRipples((prev) => prev.filter((rp) => rp.id !== id)),
      650,
    );
  };

  return (
    <motion.button
      ref={ref}
      onClick={onClick}
      onPointerMove={reduceMotion ? undefined : onMove}
      onPointerLeave={onLeave}
      onPointerDown={onPressStart}
      style={{ x: reduceMotion ? 0 : sx, y: reduceMotion ? 0 : sy }}
      className="relative inline-flex items-center gap-2.5 px-8 py-4 rounded-xl font-semibold text-[15px] cursor-pointer overflow-hidden"
      whileTap={{ scale: 0.97 }}
    >
      <span
        className="absolute inset-0 rounded-xl"
        style={{
          background: "#FFFFFF",
          boxShadow:
            "0 12px 40px -8px rgba(0,0,0,0.45), 0 0 0 1px rgba(255,255,255,0.14), inset 0 1px 0 rgba(255,255,255,0.6)",
        }}
      />
      <motion.span
        aria-hidden="true"
        className="absolute inset-0 rounded-xl pointer-events-none"
        style={{ background: shimmerBg }}
      />
      {/* Tap ripple */}
      <AnimatePresence>
        {ripples.map((rp) => (
          <motion.span
            key={rp.id}
            aria-hidden="true"
            className="absolute pointer-events-none rounded-full"
            style={{
              left: rp.x - 60,
              top: rp.y - 60,
              width: 120,
              height: 120,
              background:
                "radial-gradient(circle, rgba(167, 139, 250, 0.55), rgba(124, 58, 237, 0.18) 45%, transparent 70%)",
              mixBlendMode: "screen",
            }}
            initial={{ scale: 0, opacity: 0.9 }}
            animate={{ scale: 2.6, opacity: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
          />
        ))}
      </AnimatePresence>
      <span
        className="relative z-10 inline-flex items-center gap-2.5"
        style={{ color: "#4C1D95" }}
      >
        Try ProdScope free
        <ArrowRight className="w-4 h-4" />
      </span>
    </motion.button>
  );
}

export function FinalCTA() {
  const navigate = useNavigate();
  const reduceMotion = useReducedMotion() ?? false;

  return (
    <section
      className="relative py-24 md:py-32 overflow-hidden scroll-mt-[104px]"
      id="final-cta"
    >
      {/* Saturation bridge — fades Pricing's floor into the dark CTA */}
      <div
        aria-hidden="true"
        className="absolute top-0 left-0 right-0 h-[180px] -translate-y-full pointer-events-none"
        style={{
          background:
            "linear-gradient(180deg, rgba(250,249,255,0) 0%, rgba(76,29,149,0.04) 40%, rgba(76,29,149,0.18) 75%, rgba(30,27,75,0.42) 100%)",
        }}
      />

      {/* Bottom-edge fade — normalizes CTA floor to #1E1B4B so Footer hand-off is seamless */}
      <div
        aria-hidden="true"
        className="absolute bottom-0 left-0 right-0 h-[140px] pointer-events-none z-[5]"
        style={{
          background:
            "linear-gradient(180deg, rgba(30,27,75,0) 0%, rgba(30,27,75,0.55) 55%, rgba(30,27,75,1) 100%)",
        }}
      />

      {/* Dark gradient base */}
      <div
        aria-hidden="true"
        className="absolute inset-0"
        style={{ background: GRADIENT_BG }}
      />

      {/* Subtle radial glows */}
      <div
        aria-hidden="true"
        className="absolute inset-0 pointer-events-none"
        style={{
          background: [
            "radial-gradient(ellipse 50% 50% at 20% 30%, rgba(124, 58, 237, 0.3), transparent 60%)",
            "radial-gradient(ellipse 40% 40% at 80% 70%, rgba(219, 39, 119, 0.2), transparent 60%)",
            "radial-gradient(ellipse 60% 30% at 50% 100%, rgba(99, 102, 241, 0.15), transparent 50%)",
          ].join(", "),
        }}
      />

      {/* Animated aurora sweep */}
      <motion.div
        aria-hidden="true"
        className="absolute inset-0 pointer-events-none opacity-40"
        style={{
          background:
            "radial-gradient(ellipse 60% 50% at var(--aurora-x, 50%) 40%, rgba(175, 109, 255, 0.35), transparent 60%)",
        }}
        animate={
          reduceMotion
            ? undefined
            : ({
                ["--aurora-x" as string]: ["20%", "80%", "20%"],
              } as Record<string, string[]>)
        }
        transition={{ duration: 18, repeat: Infinity, ease: "easeInOut" }}
      />

      {/* Noise texture overlay */}
      <div
        aria-hidden="true"
        className="absolute inset-0 pointer-events-none opacity-[0.03]"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='1'/%3E%3C/svg%3E\")",
          backgroundRepeat: "repeat",
          backgroundSize: "128px 128px",
        }}
      />

      <div className="relative z-10 mx-auto max-w-[720px] px-6 text-center">
        {/* Overline pill */}
        <motion.span
          initial={reduceMotion ? {} : { opacity: 0, y: 8 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-15% 0px" }}
          transition={{ duration: 0.5, ease: EASE_OUT }}
          className="inline-flex items-center gap-2 px-3 py-1 rounded-full backdrop-blur-sm text-[11px] font-medium uppercase"
          style={{
            border: "1px solid rgba(255, 255, 255, 0.15)",
            background: "rgba(255, 255, 255, 0.06)",
            letterSpacing: "0.18em",
            color: "#C7D2FE",
          }}
        >
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          Ready when you are
        </motion.span>

        {/* Headline */}
        <motion.h2
          initial={reduceMotion ? {} : { opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-15% 0px" }}
          transition={{ duration: 0.6, delay: 0.1, ease: EASE_OUT }}
          className="text-[clamp(32px,5.5vw,56px)] font-semibold tracking-[-0.03em] leading-[1.08] text-white mt-6"
        >
          Know your app before
          <br />
          you ship it.
        </motion.h2>

        {/* Subtitle */}
        <motion.p
          initial={reduceMotion ? {} : { opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-15% 0px" }}
          transition={{ duration: 0.5, delay: 0.2, ease: EASE_OUT }}
          className="mt-5 text-[clamp(15px,1.6vw,18px)] leading-relaxed text-indigo-200/80 max-w-[480px] mx-auto"
        >
          Upload an APK. Get a full analysis report — coverage, findings,
          and health score — in under 15 minutes.
        </motion.p>

        {/* CTA button with aura */}
        <motion.div
          initial={reduceMotion ? {} : { opacity: 0, scale: 0.95 }}
          whileInView={{ opacity: 1, scale: 1 }}
          viewport={{ once: true }}
          transition={{
            type: "spring",
            stiffness: 200,
            damping: 20,
            delay: 0.3,
          }}
          className="mt-9 inline-block"
        >
          <div className="relative inline-block">
            <div
              aria-hidden="true"
              className="absolute inset-0 rounded-xl blur-2xl opacity-60 pointer-events-none"
              style={{
                background:
                  "radial-gradient(circle, rgba(175,109,255,0.45), transparent 65%)",
              }}
            />
            <MagneticCTA
              onClick={() => navigate("/login")}
              reduceMotion={reduceMotion}
            />
          </div>
        </motion.div>

        {/* Trust line */}
        <motion.p
          initial={reduceMotion ? {} : { opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ delay: 0.5, duration: 0.5 }}
          className="mt-5 text-[13px] text-indigo-300/60"
        >
          No credit card required · No SDK integration · Free to start
        </motion.p>
      </div>
    </section>
  );
}
