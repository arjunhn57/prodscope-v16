import { Link } from "react-router-dom";
import { ArrowLeft, Shield } from "lucide-react";
import { useAdminSummary } from "./adminApi";
import { SummaryCards } from "./components/SummaryCards";
import { ApplicationsTable } from "./components/ApplicationsTable";
import { UsersTable } from "./components/UsersTable";

const PAGE_BG = [
  "radial-gradient(80% 50% at 50% 0%, rgba(108,71,255,0.05) 0%, rgba(108,71,255,0) 55%)",
  "#FAFAFA",
].join(", ");

export function AdminPartnersPage() {
  const summary = useAdminSummary();

  return (
    <div className="min-h-dvh w-full" style={{ background: PAGE_BG }}>
      <header className="border-b border-[var(--color-border-subtle)] bg-white/80 backdrop-blur-sm">
        <div className="mx-auto max-w-[1200px] px-4 sm:px-6 lg:px-8 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link
              to="/dashboard"
              className="text-[13px] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] inline-flex items-center gap-1"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              Dashboard
            </Link>
            <span className="text-[var(--color-border-default)]">·</span>
            <span
              className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-[var(--color-text-primary)]"
              style={{ fontFamily: "var(--font-heading)" }}
            >
              <Shield className="w-3.5 h-3.5 text-[var(--color-accent)]" />
              Admin — Partners
            </span>
          </div>
          <div
            className="text-[11px] uppercase tracking-[0.22em] text-[var(--color-text-muted)] font-semibold"
            style={{ fontFamily: "var(--font-label)" }}
          >
            Design partner ops
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1200px] px-4 sm:px-6 lg:px-8 py-8 md:py-12 space-y-8">
        <section>
          <h1
            className="text-[28px] md:text-[32px] font-semibold text-[var(--color-text-primary)]"
            style={{ fontFamily: "var(--font-heading)", letterSpacing: "-0.02em" }}
          >
            Partner ops at a glance
          </h1>
          <p
            className="mt-1.5 text-[14px] text-[var(--color-text-secondary)] max-w-[640px]"
            style={{ fontFamily: "var(--font-sans)" }}
          >
            Track design-partner applications, per-user AI spend, and LOI
            progress. Data refreshes every 30 seconds.
          </p>
        </section>

        <SummaryCards summary={summary.data} isLoading={summary.isLoading} />

        <ApplicationsTable />

        <UsersTable />
      </main>
    </div>
  );
}
