import { Link } from "react-router-dom";
import { motion, useReducedMotion } from "framer-motion";
import { ArrowRight, CheckCircle2 } from "lucide-react";
import { TopBar } from "../../components/layout/TopBar";

const PAGE_BG = [
  "radial-gradient(80% 50% at 50% 0%, rgba(108,71,255,0.08) 0%, rgba(108,71,255,0) 55%)",
  "radial-gradient(60% 50% at 50% 0%, rgba(219,39,119,0.05) 0%, rgba(219,39,119,0) 60%)",
  "#FAFAFA",
].join(", ");

const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];

const PARTNER_BENEFITS = [
  {
    title: "Unlimited analysis runs",
    body:
      "Run ProdScope on your production app as often as you want during the program. We absorb the infrastructure cost.",
  },
  {
    title: "Hands-on review with the founder",
    body:
      "Every partner gets a 20–30 minute call where we walk through findings together and hear what actually matters for your product.",
  },
  {
    title: "Founding-customer pricing",
    body:
      "If you sign a short letter of intent and choose to convert when billing launches, you lock in the founding-customer price for 12 months.",
  },
  {
    title: "Direct line to the roadmap",
    body:
      "Design-partner feedback shapes what we build in the next six weeks. You get visibility into decisions, not just the final product.",
  },
];

const PROGRAM_ASK = [
  "Run ProdScope on your production app at least once.",
  "Give 5–10 minutes of structured feedback per run.",
  "Join a single 20–30 minute call at the end of the program.",
  "Consider signing a short non-binding letter of intent for paid launch.",
];

const FAQ = [
  {
    q: "Why is there no pricing page right now?",
    a: "Because the product is in private beta. We would rather validate the value with real founders first than ship a price that turns out to be wrong. Pricing launches publicly once we have 3+ signed letters of intent from design partners.",
  },
  {
    q: "Is this free? Forever?",
    a: "Free for the duration of the design-partner program. When paid billing ships, design partners get first access and the option to convert at a founding-customer price locked for 12 months. You are never billed retroactively for your pilot runs.",
  },
  {
    q: "What does the letter of intent commit me to?",
    a: "Nothing legally. It records your intent to subscribe at a target price if the product continues to meet your needs at launch. It is cancellable at any time, and signing it does not authorise any payment. A copy lives at docs/LOI_TEMPLATE.md.",
  },
  {
    q: "Who is the right fit for this program?",
    a: "Founders of Play Store apps 1–3 years old who ship their own product and care about polish. Apps without heavy 2FA / biometric walls work best during the beta — our engine is strongest on flows reachable by a test account.",
  },
];

export function PricingPage() {
  const reduceMotion = useReducedMotion();

  return (
    <div className="flex flex-col min-h-dvh" style={{ background: PAGE_BG }}>
      <TopBar title="Private beta" />

      <main className="flex-1 w-full">
        <div className="mx-auto w-full max-w-[920px] px-4 sm:px-6 lg:px-8 pt-10 md:pt-16 pb-24 md:pb-32 space-y-16 md:space-y-24">
          {/* Hero */}
          <motion.section
            initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 8 }}
            animate={reduceMotion ? { opacity: 1 } : { opacity: 1, y: 0 }}
            transition={{ duration: 0.45, ease: EASE }}
            className="text-center"
          >
            <div
              className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white border border-[var(--color-border-default)] text-[11px] font-semibold uppercase tracking-[0.22em] text-[var(--color-text-muted)]"
              style={{ fontFamily: "var(--font-label)" }}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-accent)]" />
              Private beta — 10 partners this month
            </div>
            <h1
              className="mt-6 text-[40px] md:text-[56px] font-semibold leading-[1.03] text-[var(--color-text-primary)]"
              style={{ fontFamily: "var(--font-heading)", letterSpacing: "-0.024em" }}
            >
              No pricing page yet.
              <br className="hidden md:block" /> Just a design-partner program.
            </h1>
            <p
              className="mx-auto mt-5 max-w-[640px] text-[16px] md:text-[17px] leading-[1.6] text-[var(--color-text-secondary)]"
              style={{ fontFamily: "var(--font-sans)" }}
            >
              ProdScope is in private beta. We're onboarding 10 founders this
              month — unlimited free analysis runs on your production app, in
              exchange for honest feedback and a short non-binding letter of
              intent for when we launch paid billing.
            </p>
            <div className="mt-8 flex items-center justify-center gap-3 flex-wrap">
              <Link
                to="/apply"
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full text-[14px] font-medium text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent-ring)] transition-opacity hover:opacity-95"
                style={{
                  background:
                    "linear-gradient(120deg, #8A6CFF 0%, #6C47FF 55%, #DB2777 100%)",
                }}
              >
                Apply as a design partner
                <ArrowRight className="w-3.5 h-3.5" />
              </Link>
              <Link
                to="/r/sample"
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-full text-[13.5px] font-medium text-[var(--color-text-secondary)] bg-white border border-[var(--color-border-default)] hover:border-[var(--color-border-hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent-ring)] transition-colors"
              >
                See a sample report
              </Link>
            </div>
          </motion.section>

          {/* Benefits */}
          <section aria-labelledby="benefits-heading">
            <h2
              id="benefits-heading"
              className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[var(--color-text-muted)]"
              style={{ fontFamily: "var(--font-label)" }}
            >
              What design partners get
            </h2>
            <div className="mt-6 grid md:grid-cols-2 gap-4 md:gap-5">
              {PARTNER_BENEFITS.map((b) => (
                <div
                  key={b.title}
                  className="bg-white border border-[var(--color-border-default)] rounded-2xl p-5 md:p-6"
                >
                  <div className="flex items-start gap-3">
                    <span className="mt-0.5 shrink-0 w-6 h-6 rounded-full bg-[#EFEBFF] text-[var(--color-accent)] inline-flex items-center justify-center">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                    </span>
                    <div>
                      <h3
                        className="text-[15px] font-semibold text-[var(--color-text-primary)]"
                        style={{ fontFamily: "var(--font-heading)" }}
                      >
                        {b.title}
                      </h3>
                      <p
                        className="mt-1.5 text-[13.5px] leading-[1.55] text-[var(--color-text-secondary)]"
                        style={{ fontFamily: "var(--font-sans)" }}
                      >
                        {b.body}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* What we ask */}
          <section aria-labelledby="ask-heading" className="grid md:grid-cols-[240px_1fr] gap-8 md:gap-12 items-start">
            <div>
              <h2
                id="ask-heading"
                className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[var(--color-text-muted)]"
                style={{ fontFamily: "var(--font-label)" }}
              >
                What we ask for
              </h2>
              <p
                className="mt-3 text-[13px] leading-[1.55] text-[var(--color-text-muted)]"
                style={{ fontFamily: "var(--font-sans)" }}
              >
                Four small things. None of them require a signed contract.
              </p>
            </div>
            <ul className="bg-white border border-[var(--color-border-default)] rounded-2xl divide-y divide-[var(--color-border-subtle)]">
              {PROGRAM_ASK.map((item, idx) => (
                <li key={item} className="flex items-start gap-3 p-4 md:p-5">
                  <span
                    className="shrink-0 w-6 h-6 rounded-full bg-[var(--color-bg-secondary,#F3F4F6)] text-[var(--color-text-muted)] text-[12px] font-semibold inline-flex items-center justify-center tabular-nums"
                    style={{ fontFamily: "var(--font-label)" }}
                  >
                    {idx + 1}
                  </span>
                  <span className="text-[14px] leading-[1.55] text-[var(--color-text-primary)]">
                    {item}
                  </span>
                </li>
              ))}
            </ul>
          </section>

          {/* FAQ */}
          <section aria-labelledby="faq-heading">
            <h2
              id="faq-heading"
              className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[var(--color-text-muted)]"
              style={{ fontFamily: "var(--font-label)" }}
            >
              Fair questions
            </h2>
            <dl className="mt-6 divide-y divide-[var(--color-border-subtle)] bg-white border border-[var(--color-border-default)] rounded-2xl">
              {FAQ.map((item) => (
                <div key={item.q} className="p-5 md:p-6">
                  <dt
                    className="text-[15px] font-semibold text-[var(--color-text-primary)]"
                    style={{ fontFamily: "var(--font-heading)" }}
                  >
                    {item.q}
                  </dt>
                  <dd
                    className="mt-2 text-[13.5px] leading-[1.6] text-[var(--color-text-secondary)]"
                    style={{ fontFamily: "var(--font-sans)" }}
                  >
                    {item.a}
                  </dd>
                </div>
              ))}
            </dl>
          </section>

          {/* Final CTA */}
          <section
            aria-labelledby="final-cta-heading"
            className="text-center rounded-2xl border border-[var(--color-border-default)] bg-white px-6 py-10 md:py-14"
          >
            <h2
              id="final-cta-heading"
              className="text-[24px] md:text-[30px] font-semibold leading-tight text-[var(--color-text-primary)]"
              style={{ fontFamily: "var(--font-heading)", letterSpacing: "-0.02em" }}
            >
              Ship polish on your app before your next release.
            </h2>
            <p
              className="mt-3 text-[14.5px] leading-[1.6] text-[var(--color-text-secondary)] max-w-[560px] mx-auto"
              style={{ fontFamily: "var(--font-sans)" }}
            >
              Apply once. If we're a fit, we'll reply within 48 hours and
              schedule a kick-off call the same week.
            </p>
            <Link
              to="/apply"
              className="mt-6 inline-flex items-center gap-2 px-5 py-2.5 rounded-full text-[14px] font-medium text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent-ring)] transition-opacity hover:opacity-95"
              style={{
                background:
                  "linear-gradient(120deg, #8A6CFF 0%, #6C47FF 55%, #DB2777 100%)",
              }}
            >
              Apply as a design partner
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </section>
        </div>
      </main>
    </div>
  );
}
