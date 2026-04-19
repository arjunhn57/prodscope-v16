const FOOTER_LINKS = [
  {
    heading: "Product",
    links: [
      { label: "Features", href: "#features" },
      { label: "Pricing", href: "#pricing" },
      { label: "FAQ", href: "#faq" },
      { label: "Sample Report", href: "#sample-report" },
    ],
  },
  {
    heading: "Resources",
    links: [
      { label: "Documentation", href: "#" },
      { label: "API Reference", href: "#" },
      { label: "Changelog", href: "#" },
    ],
  },
  {
    heading: "Company",
    links: [
      { label: "About", href: "#" },
      { label: "Contact", href: "mailto:support@prodscope.com" },
      { label: "Privacy Policy", href: "#" },
      { label: "Terms of Service", href: "#" },
    ],
  },
];

const CURRENT_YEAR = new Date().getFullYear();

function XIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      className={className}
    >
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

function GithubIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      className={className}
    >
      <path d="M12 .296c-6.627 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.6.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.744.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.108-.775.418-1.305.762-1.604-2.665-.305-5.467-1.333-5.467-5.93 0-1.311.468-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.398 3.003-.404 1.02.006 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.873.118 3.176.77.84 1.235 1.91 1.235 3.221 0 4.61-2.805 5.624-5.479 5.921.43.372.815 1.102.815 2.222v3.293c0 .319.192.694.801.576 4.766-1.589 8.2-6.086 8.2-11.385 0-6.627-5.373-12-12-12" />
    </svg>
  );
}

function LinkedinIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      className={className}
    >
      <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.063 2.063 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
    </svg>
  );
}

interface SocialLinkProps {
  href: string;
  label: string;
  children: React.ReactNode;
}

function SocialLink({ href, label, children }: SocialLinkProps) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      aria-label={label}
      className="group relative flex items-center justify-center w-10 h-10 rounded-full text-indigo-200/60 hover:text-white transition-colors duration-200"
      style={{
        border: "1px solid rgba(255, 255, 255, 0.08)",
        background: "rgba(255, 255, 255, 0.03)",
      }}
    >
      <span
        aria-hidden="true"
        className="absolute inset-0 rounded-full opacity-0 group-hover:opacity-100 transition-opacity duration-300"
        style={{
          background:
            "radial-gradient(circle, rgba(175, 109, 255, 0.22), transparent 70%)",
          boxShadow: "0 0 0 1px rgba(175, 109, 255, 0.25)",
        }}
      />
      <span className="relative">{children}</span>
    </a>
  );
}

export function Footer() {
  return (
    <footer
      className="relative overflow-hidden"
      style={{
        background:
          "linear-gradient(180deg, #1E1B4B 0%, #15123B 45%, #0F0D2E 100%)",
      }}
    >
      {/* Saturation bridge — smooths the FinalCTA → Footer hand-off */}
      <div
        aria-hidden="true"
        className="absolute top-0 left-0 right-0 h-[160px] pointer-events-none"
        style={{
          background:
            "linear-gradient(180deg, rgba(30, 27, 75, 1) 0%, rgba(30, 27, 75, 0.6) 40%, rgba(21, 18, 59, 0) 100%)",
        }}
      />

      {/* Subtle aurora echo at top-center — ties to the FinalCTA aurora sweep */}
      <div
        aria-hidden="true"
        className="absolute top-0 left-1/2 -translate-x-1/2 w-[720px] h-[280px] pointer-events-none opacity-40"
        style={{
          background:
            "radial-gradient(ellipse 60% 60% at 50% 0%, rgba(175, 109, 255, 0.18), transparent 65%)",
        }}
      />

      <div className="relative mx-auto max-w-[1120px] px-6 pt-16 md:pt-20 pb-10">
        {/* Top row: logo lockup + social icons */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-6 pb-10">
          {/* Logo lockup */}
          <div className="flex items-center gap-3">
            <div
              className="flex items-center justify-center w-9 h-9 rounded-xl"
              style={{
                background:
                  "linear-gradient(135deg, #6C47FF 0%, #A78BFA 55%, #DB2777 100%)",
                boxShadow:
                  "0 8px 22px rgba(108, 71, 255, 0.45), inset 0 1px 0 rgba(255,255,255,0.35)",
              }}
            >
              <span className="text-white text-[15px] font-bold leading-none">
                P
              </span>
            </div>
            <div>
              <span className="text-[18px] font-bold text-white tracking-tight leading-none">
                prodscope.
              </span>
              <p className="mt-1 text-[12px] text-indigo-200/60 tracking-[0.06em]">
                Know your app before you ship it.
              </p>
            </div>
          </div>

          {/* Social icons */}
          <div className="flex items-center gap-2.5">
            <SocialLink href="https://x.com" label="Follow on X">
              <XIcon className="w-[15px] h-[15px]" />
            </SocialLink>
            <SocialLink href="https://github.com" label="GitHub">
              <GithubIcon className="w-[16px] h-[16px]" />
            </SocialLink>
            <SocialLink href="https://linkedin.com" label="LinkedIn">
              <LinkedinIcon className="w-[16px] h-[16px]" />
            </SocialLink>
          </div>
        </div>

        {/* Hairline separator */}
        <div
          aria-hidden="true"
          className="h-px w-full"
          style={{
            background:
              "linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.08) 50%, transparent 100%)",
          }}
        />

        {/* Middle: brand description + link columns */}
        <div className="grid grid-cols-2 md:grid-cols-[1.3fr_1fr_1fr_1fr] gap-10 md:gap-10 pt-12">
          <div className="col-span-2 md:col-span-1 max-w-[280px]">
            <p className="text-[14px] leading-[1.65] text-indigo-200/55">
              AI-powered Android app analysis. Every screen, every flow, every
              bug — in one report.
            </p>
            <div className="mt-5 inline-flex items-center gap-2 px-2.5 py-1 rounded-full text-[11px] font-medium tracking-[0.06em]"
              style={{
                background: "rgba(16, 185, 129, 0.08)",
                border: "1px solid rgba(16, 185, 129, 0.22)",
                color: "#6EE7B7",
              }}
            >
              <span className="relative flex w-1.5 h-1.5">
                <span
                  className="absolute inset-0 rounded-full animate-ping"
                  style={{ background: "#10B981", opacity: 0.65 }}
                />
                <span className="relative w-1.5 h-1.5 rounded-full"
                  style={{ background: "#10B981" }}
                />
              </span>
              All systems operational
            </div>
          </div>

          {FOOTER_LINKS.map((col) => (
            <div key={col.heading}>
              <h4 className="text-[12px] font-semibold text-indigo-100/85 uppercase tracking-[0.14em] mb-4">
                {col.heading}
              </h4>
              <ul className="space-y-2.5">
                {col.links.map((link) => (
                  <li key={link.label}>
                    <a
                      href={link.href}
                      className="text-[14px] text-indigo-200/55 hover:text-white transition-colors duration-200"
                    >
                      {link.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* Bottom row: copyright + byline */}
        <div
          className="mt-14 pt-6 flex flex-col sm:flex-row items-center justify-between gap-4"
          style={{
            borderTop: "1px solid rgba(255, 255, 255, 0.05)",
          }}
        >
          <span className="text-[12.5px] text-indigo-200/40 tracking-[0.02em]">
            &copy; {CURRENT_YEAR} ProdScope. All rights reserved.
          </span>
          <span className="text-[12.5px] text-indigo-200/45 tracking-[0.02em]">
            Built by Arjun in India.
          </span>
        </div>
      </div>
    </footer>
  );
}
