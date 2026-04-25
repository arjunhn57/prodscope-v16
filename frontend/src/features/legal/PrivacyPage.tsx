import { useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";

const AURORA_BACKDROP =
  "radial-gradient(80% 50% at 50% 0%, rgba(108,71,255,0.06) 0%, rgba(108,71,255,0) 55%), #FAFAFA";

const SECTIONS: Array<{ heading: string; body: React.ReactNode }> = [
  {
    heading: "1. Who we are",
    body: (
      <>
        ProdScope provides AI-powered analysis of Android applications. This
        policy explains what data we collect when you use the service, how we
        use it, and your rights over it. Contact:{" "}
        <a
          className="text-[var(--color-accent)] hover:underline"
          href="mailto:hello@prodscope.app"
        >
          hello@prodscope.app
        </a>
        .
      </>
    ),
  },
  {
    heading: "2. What we collect",
    body: (
      <ul className="list-disc pl-6 space-y-1.5">
        <li>
          <strong>App binaries you submit</strong> — APK or AAB files you upload
          directly, or fetched from a Play Store URL you provide.
        </li>
        <li>
          <strong>Generated analysis output</strong> — screenshots, structural
          data extracted from the app, and the resulting report.
        </li>
        <li>
          <strong>Account information</strong> — email and a hashed password if
          you create a paid account.
        </li>
        <li>
          <strong>Payment information</strong> — handled entirely by Stripe; we
          never see or store card numbers.
        </li>
        <li>
          <strong>Basic usage data</strong> — IP address, browser, and
          timestamps for security and abuse prevention.
        </li>
      </ul>
    ),
  },
  {
    heading: "3. How we use your data",
    body: (
      <>
        To run the analysis you requested, deliver the report, provide support,
        prevent fraud and abuse, and bill you. We do not sell your data and we
        do not use your APK or report to train AI models.
      </>
    ),
  },
  {
    heading: "4. Retention",
    body: (
      <ul className="list-disc pl-6 space-y-1.5">
        <li>Uploaded APKs: deleted within 7 days of upload.</li>
        <li>Screenshots and intermediate analysis artifacts: deleted within 7 days.</li>
        <li>Reports: retained in your account until you delete them.</li>
        <li>Server logs: 30 days.</li>
      </ul>
    ),
  },
  {
    heading: "5. Third parties we use",
    body: (
      <ul className="list-disc pl-6 space-y-1.5">
        <li>
          <strong>AI inference provider</strong> — receives the screenshots and
          structural data needed to generate the analysis. No personal account
          information is shared.
        </li>
        <li>
          <strong>Stripe</strong> — processes payments. Stripe&rsquo;s privacy
          terms apply to the payment data they handle.
        </li>
        <li>
          <strong>Google Cloud Platform</strong> — hosts the infrastructure
          that runs the analysis.
        </li>
      </ul>
    ),
  },
  {
    heading: "6. Read-only by default",
    body: (
      <>
        The analyzer never types into form fields, never taps Save or Submit on
        user-data forms, and never mutates accounts inside the apps it
        analyzes. This is enforced server-side. If you opt into a future
        credentials mode, you will be told explicitly what the analyzer is
        allowed to do.
      </>
    ),
  },
  {
    heading: "7. Your rights",
    body: (
      <>
        You can request export, correction, or deletion of your data at any
        time by emailing{" "}
        <a
          className="text-[var(--color-accent)] hover:underline"
          href="mailto:hello@prodscope.app"
        >
          hello@prodscope.app
        </a>
        . We will respond within 30 days.
      </>
    ),
  },
  {
    heading: "8. Cookies",
    body: (
      <>
        We use only essential cookies (authentication session). No tracking,
        advertising, or analytics cookies.
      </>
    ),
  },
  {
    heading: "9. Changes to this policy",
    body: (
      <>
        We will email registered users about material changes at least 14 days
        before they take effect.
      </>
    ),
  },
  {
    heading: "10. Contact",
    body: (
      <a
        className="text-[var(--color-accent)] hover:underline"
        href="mailto:hello@prodscope.app"
      >
        hello@prodscope.app
      </a>
    ),
  },
];

export function PrivacyPage() {
  const navigate = useNavigate();

  return (
    <div
      className="min-h-dvh"
      style={{ background: AURORA_BACKDROP }}
    >
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

        <h1
          className="mt-6 text-[34px] sm:text-[40px] font-semibold text-[var(--color-text-primary)] leading-[1.1]"
          style={{ fontFamily: "var(--font-heading)", letterSpacing: "-0.02em" }}
        >
          Privacy Policy
        </h1>

        <div
          className="mt-3 inline-block rounded-md border border-[rgba(15,23,42,0.08)] bg-white/60 px-3 py-1.5 text-[12px] text-[var(--color-text-muted)]"
          style={{ fontFamily: "var(--font-sans)" }}
        >
          Last updated: April 26, 2026 · ProdScope, an Android app analysis service
        </div>

        <div
          className="mt-8 space-y-7 text-[14px] leading-[1.75] text-[var(--color-text-secondary)]"
          style={{ fontFamily: "var(--font-sans)" }}
        >
          {SECTIONS.map(({ heading, body }) => (
            <section key={heading}>
              <h2
                className="text-[14.5px] font-semibold text-[var(--color-text-primary)] mb-2"
                style={{ fontFamily: "var(--font-label)" }}
              >
                {heading}
              </h2>
              <div>{body}</div>
            </section>
          ))}
        </div>

        <div className="h-20" />
      </div>
    </div>
  );
}
