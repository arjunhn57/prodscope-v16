import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, ChevronDown } from "lucide-react";

const AURORA_BACKDROP =
  "radial-gradient(80% 50% at 50% 0%, rgba(214,43,77,0.06) 0%, rgba(108,71,255,0.04) 35%, rgba(108,71,255,0) 65%), #FAFAFA";

interface FaqItem {
  q: string;
  a: React.ReactNode;
}

interface FaqGroup {
  heading: string;
  items: FaqItem[];
}

const GROUPS: FaqGroup[] = [
  {
    heading: "What it is",
    items: [
      {
        q: "What kinds of apps work with ProdScope?",
        a: (
          <>
            Most consumer Android apps that boot to a usable surface — feed
            apps, social apps, productivity tools, marketplace apps, fintech
            apps that allow self-signup. We work directly from your APK, so
            no SDK integration is required.
          </>
        ),
      },
      {
        q: "What apps don't work well?",
        a: (
          <>
            Anything heavily protected by anti-emulator integrity checks
            (most banking apps, some games), apps that require a paid
            subscription before any meaningful surface, apps with phone-OTP
            login when no test number is provided, and apps that depend on a
            specific device's hardware (Bluetooth peripherals, NFC, camera
            ML). If you're unsure, send us the APK and we'll tell you within
            an hour whether it's a fit.
          </>
        ),
      },
      {
        q: "How long does an analysis take?",
        a: (
          <>
            Typically 5–8 minutes from upload to delivered report. Larger
            apps with many surface areas can take up to 12 minutes. You can
            close the browser; we email when it's done.
          </>
        ),
      },
      {
        q: "Can I run my competitors?",
        a: (
          <>
            Yes. ProdScope works on any Android APK you legally have access
            to, including competitor apps from public stores. Many of our
            best-fit users run their competitors first to benchmark, then
            their own build to compare.
          </>
        ),
      },
    ],
  },
  {
    heading: "What you get",
    items: [
      {
        q: "What's actually in the report?",
        a: (
          <>
            A verdict (3 sentences a VC can read in 60 seconds), a spotlight
            finding with annotated proof, an analyst-voice executive summary,
            strengths + critical findings + UX issues each with concrete
            recommendations, founder-questions specific to this app's
            evidence, a screen-by-screen atlas, and a coverage breakdown
            that names what we couldn't reach. See the{" "}
            <a
              href="/methodology"
              className="text-[var(--color-report-accent)] underline decoration-[rgba(214,43,77,0.28)] underline-offset-[3px] hover:decoration-[rgba(214,43,77,0.65)]"
            >
              methodology page
            </a>{" "}
            for the full structure.
          </>
        ),
      },
      {
        q: "How accurate are the findings?",
        a: (
          <>
            Every claim cites the screen it came from. If we say "the home
            feed renders nothing for 4 seconds," there's a screenshot in the
            report showing exactly that. We over-index on evidence — we'd
            rather miss a finding than fabricate one. That said, the
            recommendations in each finding are educated suggestions, not
            engineering specs; you and your team are the experts on
            implementation.
          </>
        ),
      },
      {
        q: "Can I get a PDF version?",
        a: (
          <>
            Yes — every report has a "Save as PDF" button at the top. Your
            browser's print dialog produces a clean PDF with a branded cover
            page and per-page footer. Forward the email's link or attach the
            PDF — both work.
          </>
        ),
      },
    ],
  },
  {
    heading: "Privacy & data",
    items: [
      {
        q: "What data do you keep?",
        a: (
          <>
            Your APK file, the screenshots captured during the run, the
            extracted screen structure (text + layout — no image
            recognition outside of what we tell you about), and the report
            itself. We do not extract user data from the app, do not retain
            personally identifiable information, and never use your APK or
            report to train AI models. Full details on the{" "}
            <a
              href="/privacy"
              className="text-[var(--color-report-accent)] underline decoration-[rgba(214,43,77,0.28)] underline-offset-[3px] hover:decoration-[rgba(214,43,77,0.65)]"
            >
              privacy page
            </a>
            .
          </>
        ),
      },
      {
        q: "Do you log into the app?",
        a: (
          <>
            Only with credentials you explicitly provide at upload time. If
            no credentials are supplied, ProdScope analyzes the public,
            pre-auth surface only and notes which areas it couldn't reach
            because of an auth wall. We never use your team's accounts or
            scrape data from inside the app.
          </>
        ),
      },
      {
        q: "How long do you retain my report?",
        a: (
          <>
            Reports are retained for 90 days by default so you can re-share
            or download. You can request deletion at any time via the
            dashboard or by emailing{" "}
            <a
              href="mailto:hello@prodscope.app"
              className="text-[var(--color-report-accent)] underline decoration-[rgba(214,43,77,0.28)] underline-offset-[3px] hover:decoration-[rgba(214,43,77,0.65)]"
            >
              hello@prodscope.app
            </a>
            .
          </>
        ),
      },
    ],
  },
  {
    heading: "Pricing & support",
    items: [
      {
        q: "What does it cost?",
        a: (
          <>
            See the{" "}
            <a
              href="/pricing"
              className="text-[var(--color-report-accent)] underline decoration-[rgba(214,43,77,0.28)] underline-offset-[3px] hover:decoration-[rgba(214,43,77,0.65)]"
            >
              pricing page
            </a>
            . Short version: there's a free tier so you can run your own
            app once and see the deliverable, plus paid plans for teams
            who run multiple apps regularly.
          </>
        ),
      },
      {
        q: "What's the refund policy?",
        a: (
          <>
            If a paid analysis fails to produce a useful report (the crawl
            terminated before reaching the app's main surface, V2 errors,
            etc.), we automatically credit you a free re-run AND a refund
            on the failed one. No questions asked. We don't bill you for
            broken output.
          </>
        ),
      },
      {
        q: "How do I get help?",
        a: (
          <>
            Email{" "}
            <a
              href="mailto:hello@prodscope.app"
              className="text-[var(--color-report-accent)] underline decoration-[rgba(214,43,77,0.28)] underline-offset-[3px] hover:decoration-[rgba(214,43,77,0.65)]"
            >
              hello@prodscope.app
            </a>{" "}
            with your report ID and a description. A founder personally
            replies within 24 hours during the design-partner phase.
          </>
        ),
      },
    ],
  },
];

interface FaqAccordionProps {
  group: FaqGroup;
}

function FaqAccordion({ group }: FaqAccordionProps) {
  const [openKey, setOpenKey] = useState<string | null>(null);

  return (
    <div>
      <h2
        className="text-[20px] sm:text-[22px] font-semibold text-[var(--color-text-primary)] leading-[1.25] mb-4"
        style={{ fontFamily: "var(--font-heading)", letterSpacing: "-0.02em" }}
      >
        {group.heading}
      </h2>
      <ul className="flex flex-col gap-2.5">
        {group.items.map((item) => {
          const isOpen = openKey === item.q;
          return (
            <li
              key={item.q}
              className="rounded-[14px] bg-white border border-[var(--color-border-default)]"
            >
              <button
                type="button"
                onClick={() => setOpenKey(isOpen ? null : item.q)}
                aria-expanded={isOpen}
                className="w-full flex items-start justify-between gap-4 px-5 py-4 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-report-accent-ring)] rounded-[14px]"
              >
                <span
                  className="text-[14.5px] sm:text-[15px] font-semibold text-[var(--color-text-primary)] leading-[1.4]"
                  style={{ fontFamily: "var(--font-heading)" }}
                >
                  {item.q}
                </span>
                <ChevronDown
                  className={`w-4 h-4 text-[var(--color-text-muted)] flex-shrink-0 transition-transform duration-200 ${
                    isOpen ? "rotate-180" : ""
                  }`}
                  style={{ marginTop: 4 }}
                />
              </button>
              {isOpen && (
                <div
                  className="px-5 pb-5 text-[14px] leading-[1.7] text-[var(--color-text-secondary)]"
                  style={{ fontFamily: "var(--font-sans)" }}
                >
                  {item.a}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function FaqPage() {
  const navigate = useNavigate();

  return (
    <div className="min-h-dvh" style={{ background: AURORA_BACKDROP }}>
      <div className="mx-auto max-w-[760px] px-5 sm:px-8 py-10 md:py-14">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="inline-flex items-center gap-2 text-[12.5px] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent-ring)] rounded"
          style={{ fontFamily: "var(--font-sans)" }}
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Back
        </button>

        <div
          className="mt-8 text-[10.5px] font-semibold uppercase tracking-[0.22em] text-[var(--color-text-muted)]"
          style={{ fontFamily: "var(--font-label)" }}
        >
          FAQ
        </div>

        <h1
          className="mt-3 text-[36px] sm:text-[44px] font-semibold text-[var(--color-text-primary)] leading-[1.05]"
          style={{ fontFamily: "var(--font-heading)", letterSpacing: "-0.02em" }}
        >
          Questions, answered.
        </h1>

        <p
          className="mt-5 max-w-[58ch] text-[15px] sm:text-[16px] leading-[1.7] text-[var(--color-text-secondary)]"
          style={{ fontFamily: "var(--font-sans)" }}
        >
          The questions we get asked most often, organized by topic. Don't
          see yours? Email{" "}
          <a
            href="mailto:hello@prodscope.app"
            className="text-[var(--color-report-accent)] underline decoration-[rgba(214,43,77,0.28)] underline-offset-[3px] hover:decoration-[rgba(214,43,77,0.65)]"
          >
            hello@prodscope.app
          </a>{" "}
          and we'll add it.
        </p>

        <div className="mt-10 flex flex-col gap-10">
          {GROUPS.map((g) => (
            <FaqAccordion key={g.heading} group={g} />
          ))}
        </div>

        <div className="h-20" />
      </div>
    </div>
  );
}
