import { useEffect, useRef, useState } from "react";
import {
  motion,
  AnimatePresence,
  useReducedMotion,
} from "framer-motion";
import {
  Check,
  ArrowRight,
  Sparkles,
  Plus,
  Minus,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { TIERS, PRICING_FAQS, type TierPlan } from "../../pricing/tiers";

const ACCENT = "#6C47FF";
const TEXT_PRIMARY = "#0F172A";
const TEXT_MUTED = "#475569";
const EASE_OUT: [number, number, number, number] = [0.22, 1, 0.36, 1];

const HEADLINE_GRADIENT =
  "linear-gradient(120deg, #1E1B4B 0%, #4C1D95 32%, #6C47FF 58%, #DB2777 100%)";

/* ── Spotlight styles (injected once) ─────────────────────────────────────── */

const SPOTLIGHT_CSS = `
[data-spotlight] {
  --x: 0; --y: 0; --xp: 0; --yp: 0;
  --size: 250;
  --border: 1.5;
  --radius: 20;
  --border-size: calc(var(--border) * 1px);
  --spotlight-size: calc(var(--size) * 1px);
  --hue: calc(var(--base) + (var(--xp) * var(--spread)));
  background-image: radial-gradient(
    var(--spotlight-size) var(--spotlight-size) at
    calc(var(--x) * 1px) calc(var(--y) * 1px),
    hsl(var(--hue) 80% 65% / 0.07), transparent
  );
  background-size: calc(100% + 2 * var(--border-size)) calc(100% + 2 * var(--border-size));
  background-position: 50% 50%;
  background-attachment: fixed;
  border: var(--border-size) solid hsl(0 0% 85% / 0.5);
  transition: border-color 0.3s;
}
[data-spotlight]:hover {
  border-color: hsl(var(--hue) 60% 70% / 0.5);
}
[data-spotlight]::before,
[data-spotlight]::after {
  pointer-events: none;
  content: "";
  position: absolute;
  inset: calc(var(--border-size) * -1);
  border: var(--border-size) solid transparent;
  border-radius: calc(var(--radius) * 1px);
  background-attachment: fixed;
  background-size: calc(100% + 2 * var(--border-size)) calc(100% + 2 * var(--border-size));
  background-repeat: no-repeat;
  background-position: 50% 50%;
  mask: linear-gradient(transparent, transparent), linear-gradient(white, white);
  mask-clip: padding-box, border-box;
  mask-composite: intersect;
  -webkit-mask-composite: source-in;
}
[data-spotlight]::before {
  background-image: radial-gradient(
    calc(var(--spotlight-size) * 0.75) calc(var(--spotlight-size) * 0.75) at
    calc(var(--x) * 1px) calc(var(--y) * 1px),
    hsl(var(--hue) 80% 55% / 0.8), transparent 100%
  );
  filter: brightness(1.5);
}
[data-spotlight]::after {
  background-image: radial-gradient(
    calc(var(--spotlight-size) * 0.5) calc(var(--spotlight-size) * 0.5) at
    calc(var(--x) * 1px) calc(var(--y) * 1px),
    hsl(0 0% 100% / 0.7), transparent 100%
  );
}
`;

function useSpotlightPointer() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const sync = (e: PointerEvent) => {
      el.style.setProperty("--x", e.clientX.toFixed(2));
      el.style.setProperty("--y", e.clientY.toFixed(2));
      el.style.setProperty(
        "--xp",
        (e.clientX / window.innerWidth).toFixed(2),
      );
      el.style.setProperty(
        "--yp",
        (e.clientY / window.innerHeight).toFixed(2),
      );
    };
    document.addEventListener("pointermove", sync);
    return () => document.removeEventListener("pointermove", sync);
  }, []);

  return ref;
}

/* ── Pricing data ─────────────────────────────────────────────────────────── */

interface PlanDisplay {
  name: string;
  price: string;
  period: string;
  description: string;
  features: string[];
  cta: string;
  popular: boolean;
  glowBase: number;
  glowSpread: number;
}

const MARKETING_META: Record<
  TierPlan["tier"],
  { cta: string; glowBase: number; glowSpread: number }
> = {
  free: { cta: "Get started free", glowBase: 220, glowSpread: 200 },
  pro: { cta: "Start 14-day trial", glowBase: 270, glowSpread: 280 },
  enterprise: { cta: "Contact sales", glowBase: 320, glowSpread: 200 },
};

function priceLabel(plan: TierPlan): string {
  if (plan.monthlyUsd === 0) return "$0";
  return `$${plan.monthlyUsd}`;
}

const PLANS: readonly PlanDisplay[] = TIERS.map((plan) => ({
  name: plan.name,
  price: priceLabel(plan),
  period: plan.monthlyUsd === 0 ? "/forever" : "/month",
  description: plan.tagline,
  features: plan.bullets,
  cta: MARKETING_META[plan.tier].cta,
  popular: plan.highlighted,
  glowBase: MARKETING_META[plan.tier].glowBase,
  glowSpread: MARKETING_META[plan.tier].glowSpread,
}));

/* ── FAQ data ─────────────────────────────────────────────────────────────── */

const FAQS = PRICING_FAQS.slice(0, 5);

/* ── Spotlight Card ───────────────────────────────────────────────────────── */

function SpotlightCard({
  plan,
  delay,
  reduceMotion,
}: {
  plan: PlanDisplay;
  delay: number;
  reduceMotion: boolean;
}) {
  const navigate = useNavigate();
  const spotRef = useSpotlightPointer();

  return (
    <motion.div
      initial={reduceMotion ? {} : { opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-10% 0px" }}
      transition={{ duration: 0.6, delay, ease: EASE_OUT }}
      whileHover={reduceMotion ? {} : { y: -6 }}
      className={plan.popular ? "lg:-mt-10 lg:-mb-16" : "h-full"}
    >
      <motion.div
        ref={spotRef}
        data-spotlight=""
        whileHover={
          reduceMotion
            ? {}
            : {
                boxShadow: plan.popular
                  ? "0 36px 80px -14px rgba(76, 29, 149, 0.30), 0 12px 28px -6px rgba(124, 58, 237, 0.18), inset 0 1px 0 rgba(255, 255, 255, 1), inset 0 -1px 0 rgba(124, 58, 237, 0.10)"
                  : "0 28px 60px -14px rgba(15, 23, 42, 0.16), 0 4px 12px rgba(51, 65, 85, 0.06), inset 0 1px 0 rgba(255, 255, 255, 1), inset 0 -1px 0 rgba(148, 163, 184, 0.10)",
              }
        }
        transition={{ duration: 0.3, ease: EASE_OUT }}
        className={[
          "relative rounded-[18px] flex flex-col",
          plan.popular
            ? "p-6 md:p-8 lg:pt-12 lg:pb-28 lg:px-8"
            : "p-6 md:p-8 h-full",
        ].join(" ")}
        style={
          {
            "--base": plan.glowBase,
            "--spread": plan.glowSpread,
            background:
              "linear-gradient(180deg, rgba(255, 255, 255, 0.98), rgba(250, 252, 255, 0.90))",
            backdropFilter: "blur(10px)",
            boxShadow: plan.popular
              ? "0 28px 64px -12px rgba(76, 29, 149, 0.22), 0 8px 20px -4px rgba(124, 58, 237, 0.12), inset 0 1px 0 rgba(255, 255, 255, 1), inset 0 -1px 0 rgba(124, 58, 237, 0.08)"
              : "0 20px 48px -14px rgba(15, 23, 42, 0.10), 0 2px 6px rgba(15, 23, 42, 0.04), inset 0 1px 0 rgba(255, 255, 255, 1), inset 0 -1px 0 rgba(148, 163, 184, 0.08)",
            border: plan.popular ? `2px solid ${ACCENT}` : undefined,
          } as React.CSSProperties
        }
      >
        {/* Popular badge */}
        {plan.popular && (
          <div
            className="absolute -top-3 left-1/2 -translate-x-1/2 px-4 py-1 rounded-full text-[11px] font-bold uppercase tracking-[0.1em] text-white"
            style={{ background: HEADLINE_GRADIENT }}
          >
            Recommended
          </div>
        )}

        {/* Plan header */}
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-1">
            <h3
              className="text-[18px] font-bold"
              style={{ color: TEXT_PRIMARY }}
            >
              {plan.name}
            </h3>
            {plan.popular && (
              <Sparkles size={16} color={ACCENT} strokeWidth={2} />
            )}
          </div>
          <p className="text-[13px] mb-5" style={{ color: TEXT_MUTED }}>
            {plan.description}
          </p>
          <div className="flex items-baseline gap-1">
            <span
              className="text-[40px] md:text-[44px] font-bold leading-none tracking-tight"
              style={{ color: TEXT_PRIMARY }}
            >
              {plan.price}
            </span>
            <span className="text-[15px]" style={{ color: TEXT_MUTED }}>
              {plan.period}
            </span>
          </div>
        </div>

        {/* Features */}
        <ul className="space-y-3 mb-8">
          {plan.features.map((feature) => (
            <li
              key={feature}
              className="flex items-start gap-2.5 text-[14px]"
              style={{ color: TEXT_PRIMARY }}
            >
              <Check
                size={16}
                color={ACCENT}
                strokeWidth={2.5}
                className="shrink-0 mt-0.5"
              />
              {feature}
            </li>
          ))}
        </ul>

        {/* CTA */}
        <div className="mt-auto" />
        <button
          onClick={() => navigate("/login")}
          className="w-full flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl font-semibold text-[15px] cursor-pointer transition-all hover:-translate-y-0.5"
          style={
            plan.popular
              ? {
                  background: HEADLINE_GRADIENT,
                  color: "white",
                  boxShadow:
                    "0 8px 20px -6px rgba(124, 58, 237, 0.4), 0 4px 10px -4px rgba(219, 39, 119, 0.2)",
                }
              : {
                  background: "white",
                  color: ACCENT,
                  border: `2px solid ${ACCENT}`,
                }
          }
        >
          {plan.cta}
          <ArrowRight size={16} />
        </button>
      </motion.div>
    </motion.div>
  );
}

/* ── FAQ Accordion ────────────────────────────────────────────────────────── */

function FaqAccordion({ reduceMotion }: { reduceMotion: boolean }) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  return (
    <motion.div
      initial={reduceMotion ? {} : { opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-10% 0px" }}
      transition={{ duration: 0.6, delay: 0.2, ease: EASE_OUT }}
      id="faq"
      className="mt-20 md:mt-28 max-w-[720px] mx-auto scroll-mt-24"
    >
      <h3
        className="text-[clamp(24px,3vw,36px)] font-bold tracking-[-0.02em] text-center mb-8"
        style={{ color: TEXT_PRIMARY }}
      >
        Frequently asked questions
      </h3>

      <motion.div
        className="rounded-2xl overflow-hidden backdrop-blur-sm"
        style={{
          border: "1px solid rgba(15, 23, 42, 0.08)",
          background: "rgba(255, 255, 255, 0.6)",
        }}
        variants={{
          hidden: {},
          show: { transition: { staggerChildren: 0.05 } },
        }}
        initial={reduceMotion ? undefined : "hidden"}
        whileInView={reduceMotion ? undefined : "show"}
        viewport={{ once: true, margin: "-10% 0px" }}
      >
        {FAQS.map((faq, i) => {
          const isOpen = openIndex === i;
          const num = String(i + 1).padStart(2, "0");
          return (
            <motion.div
              key={i}
              variants={{
                hidden: { opacity: 0, y: 6 },
                show: { opacity: 1, y: 0 },
              }}
              transition={{ duration: 0.3, ease: EASE_OUT }}
              className={`relative transition-colors ${
                i > 0 ? "border-t" : ""
              }`}
              style={{
                borderColor: "rgba(15, 23, 42, 0.06)",
                background: isOpen
                  ? "rgba(108, 71, 255, 0.035)"
                  : "transparent",
              }}
            >
              <button
                aria-expanded={isOpen}
                onClick={() => setOpenIndex(isOpen ? null : i)}
                className="w-full flex items-center gap-4 px-5 py-4 text-left cursor-pointer group"
                style={{ transition: "background 0.2s" }}
                onMouseEnter={(e) => {
                  if (!isOpen)
                    (e.currentTarget as HTMLButtonElement).style.background =
                      "rgba(108, 71, 255, 0.02)";
                }}
                onMouseLeave={(e) => {
                  if (!isOpen)
                    (e.currentTarget as HTMLButtonElement).style.background =
                      "transparent";
                }}
              >
                <span
                  className="text-[11px] font-mono tabular-nums tracking-[0.12em] shrink-0"
                  style={{ color: ACCENT, opacity: 0.7 }}
                >
                  {num}
                </span>
                <span
                  className="flex-1 text-[15px] font-medium tracking-[-0.01em]"
                  style={{ color: TEXT_PRIMARY }}
                >
                  {faq.q}
                </span>
                <span
                  aria-hidden="true"
                  className="shrink-0 w-6 h-6 rounded-full flex items-center justify-center"
                  style={{
                    background: isOpen
                      ? "rgba(108, 71, 255, 0.12)"
                      : "rgba(15, 23, 42, 0.04)",
                    transition: "background 0.2s",
                  }}
                >
                  <AnimatePresence mode="wait" initial={false}>
                    {isOpen ? (
                      <motion.span
                        key="minus"
                        initial={{ rotate: -90, opacity: 0 }}
                        animate={{ rotate: 0, opacity: 1 }}
                        exit={{ rotate: 90, opacity: 0 }}
                        transition={{ duration: 0.18, ease: EASE_OUT }}
                        className="flex"
                      >
                        <Minus size={12} color={ACCENT} strokeWidth={2.5} />
                      </motion.span>
                    ) : (
                      <motion.span
                        key="plus"
                        initial={{ rotate: 90, opacity: 0 }}
                        animate={{ rotate: 0, opacity: 1 }}
                        exit={{ rotate: -90, opacity: 0 }}
                        transition={{ duration: 0.18, ease: EASE_OUT }}
                        className="flex"
                      >
                        <Plus size={12} color={TEXT_MUTED} strokeWidth={2.5} />
                      </motion.span>
                    )}
                  </AnimatePresence>
                </span>
              </button>
              <AnimatePresence initial={false}>
                {isOpen && (
                  <motion.div
                    key={`faq-${i}`}
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.28, ease: EASE_OUT }}
                    className="overflow-hidden"
                  >
                    <div className="pl-[52px] pr-5 pb-5">
                      <p
                        className="text-[14px] leading-relaxed"
                        style={{ color: TEXT_MUTED }}
                      >
                        {faq.a}
                      </p>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          );
        })}
      </motion.div>
    </motion.div>
  );
}

/* ── Main Section ─────────────────────────────────────────────────────────── */

export function Pricing() {
  const reduceMotion = useReducedMotion() ?? false;
  useEffect(() => {
    const STYLE_ID = "spotlight-css";
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = SPOTLIGHT_CSS;
    document.head.appendChild(style);
  }, []);

  return (
    <section
      id="pricing"
      role="region"
      aria-label="Pricing plans"
      className="relative w-full overflow-hidden py-24 lg:py-32 px-6"
      style={{
        background: [
          "radial-gradient(ellipse 50% 25% at 75% 20%, rgba(124, 58, 237, 0.05), transparent 55%)",
          "radial-gradient(ellipse 45% 20% at 20% 80%, rgba(175, 109, 255, 0.04), transparent 50%)",
          "linear-gradient(180deg, #FAF9FF 0%, #F8FAFC 40%, #FAF9FF 100%)",
        ].join(", "),
      }}
    >
      <div className="relative mx-auto max-w-[1120px]">
        {/* Heading */}
        <motion.div
          initial={reduceMotion ? {} : { opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-15% 0px" }}
          transition={{ duration: 0.6, ease: EASE_OUT }}
          className="text-center mb-14"
        >
          <h2
            className="inline-block text-[clamp(36px,5vw,56px)] font-semibold tracking-[-0.03em] leading-[1.05] bg-clip-text text-transparent"
            style={{
              backgroundImage: HEADLINE_GRADIENT,
              WebkitBackgroundClip: "text",
            }}
          >
            Simple pricing.
          </h2>
          <p
            className="mt-5 mx-auto leading-[1.6]"
            style={{
              color: TEXT_MUTED,
              fontSize: "clamp(16px, 1.8vw, 20px)",
              maxWidth: 520,
            }}
          >
            Start free. Upgrade when you need unlimited analyses, full reports,
            and API access.
          </p>
        </motion.div>

        {/* Cards */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 lg:gap-8 max-w-[440px] lg:max-w-[1080px] mx-auto">
          {PLANS.map((plan, i) => (
            <SpotlightCard
              key={plan.name}
              plan={plan}
              delay={0.1 + i * 0.12}
              reduceMotion={reduceMotion}
            />
          ))}
        </div>

        {/* Trust line */}
        <motion.p
          initial={reduceMotion ? {} : { opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ delay: 0.4, duration: 0.5 }}
          className="mt-8 text-center text-[13px]"
          style={{ color: TEXT_MUTED }}
        >
          No credit card required. Cancel anytime.
        </motion.p>

        {/* FAQ */}
        <FaqAccordion reduceMotion={reduceMotion} />
      </div>
    </section>
  );
}
