import { DollarSign, Users, Inbox, FileSignature } from "lucide-react";
import type { AdminSummary } from "../adminApi";

interface Props {
  summary: AdminSummary | undefined;
  isLoading: boolean;
}

const CARD_BASE =
  "rounded-2xl bg-white border border-[var(--color-border-default)] p-5";

function formatUsd(value: number): string {
  if (!Number.isFinite(value) || value === 0) return "$0.00";
  if (value < 1) return `$${value.toFixed(4)}`;
  if (value < 100) return `$${value.toFixed(2)}`;
  return `$${Math.round(value).toLocaleString()}`;
}

export function SummaryCards({ summary, isLoading }: Props) {
  const cards = [
    {
      label: "Last 7d spend",
      icon: DollarSign,
      value: summary ? formatUsd(summary.spend.last7dUsd) : "—",
      sub: summary
        ? `${summary.spend.last7dJobs} crawls · $${summary.spend.lifetimeUsd.toFixed(
            2
          )} lifetime`
        : "—",
      accent:
        summary && summary.spend.last7dUsd > 10
          ? "text-[#B91C1C]"
          : "text-[var(--color-text-primary)]",
    },
    {
      label: "Active users",
      icon: Users,
      value: summary ? String(summary.users.total) : "—",
      sub: summary
        ? `${summary.users.designPartners} design partners · ${summary.users.admins} admins`
        : "—",
      accent: "text-[var(--color-text-primary)]",
    },
    {
      label: "Applications",
      icon: Inbox,
      value: summary ? String(summary.applications.total) : "—",
      sub: summary
        ? `${summary.applications.new} new in inbox`
        : "—",
      accent:
        summary && summary.applications.new > 0
          ? "text-[var(--color-accent)]"
          : "text-[var(--color-text-primary)]",
    },
    {
      label: "LOIs signed",
      icon: FileSignature,
      value: summary ? String(summary.applications.loiSigned) : "—",
      sub: summary && summary.applications.loiSigned >= 3
        ? "Threshold hit — ship Stripe."
        : summary
          ? `Need ${Math.max(0, 3 - summary.applications.loiSigned)} more to hit goal`
          : "—",
      accent:
        summary && summary.applications.loiSigned >= 3
          ? "text-[#059669]"
          : "text-[var(--color-text-primary)]",
    },
  ];

  return (
    <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {cards.map((c) => {
        const Icon = c.icon;
        return (
          <div key={c.label} className={CARD_BASE}>
            <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] font-semibold text-[var(--color-text-muted)]">
              <Icon className="w-3.5 h-3.5" />
              {c.label}
            </div>
            <div
              className={`mt-3 text-[28px] font-semibold tabular-nums ${c.accent}`}
              style={{ fontFamily: "var(--font-heading)", letterSpacing: "-0.02em" }}
            >
              {isLoading && !summary ? "…" : c.value}
            </div>
            <div className="mt-1 text-[12px] text-[var(--color-text-secondary)]">
              {c.sub}
            </div>
          </div>
        );
      })}
    </section>
  );
}
