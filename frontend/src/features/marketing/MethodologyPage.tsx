import { useNavigate } from "react-router-dom";
import { ArrowLeft, ArrowRight } from "lucide-react";

const AURORA_BACKDROP =
  "radial-gradient(80% 50% at 50% 0%, rgba(214,43,77,0.06) 0%, rgba(108,71,255,0.04) 35%, rgba(108,71,255,0) 65%), #FAFAFA";

const STEPS: Array<{
  number: string;
  title: string;
  body: React.ReactNode;
}> = [
  {
    number: "01",
    title: "Boot the app on a real Android device",
    body: (
      <>
        Every analysis starts with the actual app running on a real Android
        environment — the same conditions a first-time user would see. We work
        with your APK directly; no SDK integration, no privileged access, no
        instrumentation required.
      </>
    ),
  },
  {
    number: "02",
    title: "Navigate the app like a thoughtful first user",
    body: (
      <>
        ProdScope's analysis engine works through the app screen by screen the
        way a careful evaluator would — taking the visible action on each
        screen, reading what's there, deciding what to try next. It explores
        the way a senior product reviewer would: observant, systematic, never
        random.
      </>
    ),
  },
  {
    number: "03",
    title: "Capture every screen with full context",
    body: (
      <>
        Every screen reached during the run is captured: the visual state, the
        elements on the page, the sequence of taps that led there. This becomes
        the evidence base for every claim in the report — nothing is asserted
        without a screen the reader can scrutinize.
      </>
    ),
  },
  {
    number: "04",
    title: "Surface findings — concerns AND strengths",
    body: (
      <>
        The analysis layer reads each captured screen and extracts the things a
        diligence reader actually wants to know: friction points, broken flows,
        accessibility gaps — and the moments of craft that signal a serious
        product team. Every claim cites the screen it came from.
      </>
    ),
  },
  {
    number: "05",
    title: "Annotate the proof",
    body: (
      <>
        For the most material findings, we draw the evidence directly on the
        screenshot — bounding the element, captioning the issue. The report you
        receive isn't a wall of text; it's screenshots with arrows pointing at
        what matters.
      </>
    ),
  },
];

const REPORT_SECTIONS: Array<{ label: string; body: string }> = [
  {
    label: "Verdict",
    body:
      "Three sentences a VC partner can read in 60 seconds and walk into a meeting with.",
  },
  {
    label: "Spotlight finding",
    body:
      "The single sharpest issue with annotated proof + a concrete fix. The 'wow' moment.",
  },
  {
    label: "Executive summary",
    body:
      "Senior-analyst voice — top concern, top strength, coverage limit, closing take.",
  },
  {
    label: "Strengths",
    body:
      "What the app gets right. ProdScope is a balanced read, not a gripe list.",
  },
  {
    label: "Critical findings",
    body:
      "Each finding includes why it matters, the evidence screen, and the recommended fix.",
  },
  {
    label: "Founder questions",
    body:
      "Specific diligence questions, anchored in this app's evidence. Not generic checklists.",
  },
  {
    label: "Screen atlas",
    body:
      "Every captured screen, grouped by feature area, annotated where applicable.",
  },
  {
    label: "Coverage breakdown",
    body:
      "What we explored, what we couldn't reach (paywall, auth-walled, etc.), and why it matters.",
  },
];

const NON_GOALS: Array<{ label: string; body: string }> = [
  {
    label: "We don't replace QA testers",
    body:
      "Manual testers find regressions in the workflows your team built; ProdScope evaluates the build a first user would experience. Different jobs.",
  },
  {
    label: "We don't run automated regression suites",
    body:
      "If your goal is 'check that my login flow still works after every commit,' use Espresso / Detox / Maestro. ProdScope is for human-judgement diligence.",
  },
  {
    label: "We don't see your private codebase or analytics",
    body:
      "You give us an APK; we tell you what we observe at the surface. Your source, your dashboards, and your user data stay with you.",
  },
  {
    label: "We don't claim 100% coverage",
    body:
      "An evaluation of a real app inside a 5–8 minute crawl reaches the surface a first user reaches. Auth-gated paid features, A/B-flagged paths, and rare error states need a human pair on top.",
  },
];

export function MethodologyPage() {
  const navigate = useNavigate();

  return (
    <div className="min-h-dvh" style={{ background: AURORA_BACKDROP }}>
      <div className="mx-auto max-w-[820px] px-5 sm:px-8 py-10 md:py-14">
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
          Methodology
        </div>

        <h1
          className="mt-3 text-[36px] sm:text-[44px] font-semibold text-[var(--color-text-primary)] leading-[1.05]"
          style={{ fontFamily: "var(--font-heading)", letterSpacing: "-0.02em" }}
        >
          How ProdScope analyzes a mobile app.
        </h1>

        <p
          className="mt-5 max-w-[64ch] text-[16px] sm:text-[17px] leading-[1.65] text-[var(--color-text-secondary)]"
          style={{ fontFamily: "var(--font-sans)" }}
        >
          We don't read your code or your dashboards. We use your APK and run
          the app on a real Android environment, navigate it like an
          observant first-time user, capture every screen with full context,
          and produce a diligence-grade report with annotated proof for every
          claim.
        </p>

        {/* Pipeline */}
        <section className="mt-12">
          <div
            className="text-[10.5px] font-semibold uppercase tracking-[0.22em] text-[var(--color-text-muted)] mb-5"
            style={{ fontFamily: "var(--font-label)" }}
          >
            The pipeline · 5 steps
          </div>

          <ol className="space-y-6">
            {STEPS.map((s) => (
              <li
                key={s.number}
                className="grid grid-cols-[60px_1fr] gap-5 sm:grid-cols-[80px_1fr] sm:gap-7"
              >
                <div
                  className="text-[26px] sm:text-[32px] font-semibold text-[var(--color-report-accent)] tabular-nums"
                  style={{
                    fontFamily: "var(--font-mono)",
                    letterSpacing: "-0.02em",
                  }}
                >
                  {s.number}
                </div>
                <div>
                  <h3
                    className="text-[18px] sm:text-[20px] font-semibold text-[var(--color-text-primary)] leading-[1.3]"
                    style={{
                      fontFamily: "var(--font-heading)",
                      letterSpacing: "-0.01em",
                    }}
                  >
                    {s.title}
                  </h3>
                  <p
                    className="mt-2 text-[14.5px] leading-[1.7] text-[var(--color-text-secondary)]"
                    style={{ fontFamily: "var(--font-sans)" }}
                  >
                    {s.body}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        {/* Report contents */}
        <section className="mt-14">
          <div
            className="text-[10.5px] font-semibold uppercase tracking-[0.22em] text-[var(--color-text-muted)] mb-5"
            style={{ fontFamily: "var(--font-label)" }}
          >
            What you receive
          </div>
          <h2
            className="text-[24px] sm:text-[28px] font-semibold text-[var(--color-text-primary)] leading-[1.2]"
            style={{ fontFamily: "var(--font-heading)", letterSpacing: "-0.02em" }}
          >
            The report has eight sections.
          </h2>
          <ul className="mt-6 grid sm:grid-cols-2 gap-x-8 gap-y-5">
            {REPORT_SECTIONS.map((sec) => (
              <li key={sec.label} className="flex flex-col gap-1.5">
                <span
                  className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--color-report-accent)]"
                  style={{ fontFamily: "var(--font-label)" }}
                >
                  {sec.label}
                </span>
                <span
                  className="text-[14px] leading-[1.6] text-[var(--color-text-secondary)]"
                  style={{ fontFamily: "var(--font-sans)" }}
                >
                  {sec.body}
                </span>
              </li>
            ))}
          </ul>
        </section>

        {/* What we don't do */}
        <section className="mt-14">
          <div
            className="text-[10.5px] font-semibold uppercase tracking-[0.22em] text-[var(--color-text-muted)] mb-5"
            style={{ fontFamily: "var(--font-label)" }}
          >
            What ProdScope is NOT
          </div>
          <h2
            className="text-[24px] sm:text-[28px] font-semibold text-[var(--color-text-primary)] leading-[1.2]"
            style={{ fontFamily: "var(--font-heading)", letterSpacing: "-0.02em" }}
          >
            Honest about scope.
          </h2>
          <ul className="mt-6 space-y-5">
            {NON_GOALS.map((n) => (
              <li key={n.label} className="flex flex-col gap-1.5">
                <span
                  className="text-[14.5px] font-semibold text-[var(--color-text-primary)]"
                  style={{ fontFamily: "var(--font-heading)" }}
                >
                  {n.label}
                </span>
                <span
                  className="text-[14px] leading-[1.65] text-[var(--color-text-secondary)]"
                  style={{ fontFamily: "var(--font-sans)" }}
                >
                  {n.body}
                </span>
              </li>
            ))}
          </ul>
        </section>

        {/* Closing CTA */}
        <section className="mt-14 pt-10 border-t border-[var(--color-border-subtle)]">
          <h2
            className="text-[22px] sm:text-[26px] font-semibold text-[var(--color-text-primary)] leading-[1.25]"
            style={{ fontFamily: "var(--font-heading)", letterSpacing: "-0.02em" }}
          >
            See what a real report looks like.
          </h2>
          <p
            className="mt-3 max-w-[58ch] text-[14.5px] leading-[1.7] text-[var(--color-text-secondary)]"
            style={{ fontFamily: "var(--font-sans)" }}
          >
            We've published an anonymized sample report from a real run.
            Every annotated screenshot, every finding, every founder question
            is real — only the app's identity is masked.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <a
              href="/sample"
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full text-[14px] font-semibold text-white transition-opacity hover:opacity-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-report-accent-ring)]"
              style={{
                background:
                  "linear-gradient(120deg, #6C47FF 0%, #D62B4D 100%)",
              }}
            >
              View sample report
              <ArrowRight className="w-3.5 h-3.5" />
            </a>
            <a
              href="/faq"
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full text-[14px] font-medium text-[var(--color-text-secondary)] bg-white border border-[var(--color-border-default)] hover:border-[var(--color-border-hover)] transition-colors"
            >
              Read the FAQ
            </a>
          </div>
        </section>

        <div className="h-20" />
      </div>
    </div>
  );
}
