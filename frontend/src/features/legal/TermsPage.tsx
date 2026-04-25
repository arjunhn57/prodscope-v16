import { useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";

const AURORA_BACKDROP =
  "radial-gradient(80% 50% at 50% 0%, rgba(108,71,255,0.06) 0%, rgba(108,71,255,0) 55%), #FAFAFA";

const SECTIONS: Array<{ heading: string; body: React.ReactNode }> = [
  {
    heading: "1. Acceptance",
    body: (
      <>
        By using ProdScope you agree to these terms. If you do not agree, do
        not use the service.
      </>
    ),
  },
  {
    heading: "2. What ProdScope is",
    body: (
      <>
        An automated service that installs an Android app you submit, exercises
        its user interface in a controlled environment, and produces a
        structured analysis report. Reports are AI-generated insights, not
        professional engineering, security, or legal advice.
      </>
    ),
  },
  {
    heading: "3. Acceptable use",
    body: (
      <ul className="list-disc pl-6 space-y-1.5">
        <li>You must own the APK you submit, or have legal right to analyze it.</li>
        <li>
          You will not use ProdScope to bypass app security controls, reverse
          engineer for malicious purposes, or violate third-party rights.
        </li>
        <li>
          You will not submit malware, prohibited content, or material that
          violates applicable law.
        </li>
        <li>No automated submission at high rates beyond purchased entitlements.</li>
      </ul>
    ),
  },
  {
    heading: "4. Payment",
    body: (
      <ul className="list-disc pl-6 space-y-1.5">
        <li>One-time purchases are charged immediately upon checkout.</li>
        <li>Subscriptions auto-renew at the end of each billing period until cancelled.</li>
        <li>
          If a run fails to complete due to a technical fault on our side, the
          credit is automatically refunded to your account.
        </li>
        <li>
          Refund requests for other reasons are reviewed case-by-case at{" "}
          <a
            className="text-[var(--color-accent)] hover:underline"
            href="mailto:hello@prodscope.app"
          >
            hello@prodscope.app
          </a>
          .
        </li>
      </ul>
    ),
  },
  {
    heading: "5. Limitation of liability",
    body: (
      <>
        The service is provided &ldquo;as is.&rdquo; We do not guarantee that
        any specific bug, security flaw, or design issue will be detected.
        Reports are best-effort outputs and should not be the sole basis for
        engineering, investment, or legal decisions. To the fullest extent
        permitted by law, our aggregate liability is limited to the fees you
        paid in the prior 12 months.
      </>
    ),
  },
  {
    heading: "6. Intellectual property",
    body: (
      <>
        You retain ownership of your APK and the generated reports. We retain
        rights to anonymized aggregate analytics about service performance.
      </>
    ),
  },
  {
    heading: "7. Termination",
    body: (
      <>
        You may stop using the service at any time. We may suspend accounts
        that violate these terms with notice where reasonable.
      </>
    ),
  },
  {
    heading: "8. Governing law",
    body: (
      <>
        These terms are governed by the laws of India. Any disputes will be
        resolved in the courts of Bengaluru, Karnataka.
      </>
    ),
  },
  {
    heading: "9. Changes",
    body: (
      <>
        We may update these terms; material changes will be communicated to
        registered users with at least 14 days notice.
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

export function TermsPage() {
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
          Terms of Service
        </h1>

        <div
          className="mt-3 inline-block rounded-md border border-[rgba(15,23,42,0.08)] bg-white/60 px-3 py-1.5 text-[12px] text-[var(--color-text-muted)]"
          style={{ fontFamily: "var(--font-sans)" }}
        >
          Last updated: April 26, 2026
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
