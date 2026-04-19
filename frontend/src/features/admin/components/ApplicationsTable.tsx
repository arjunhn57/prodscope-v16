import { ExternalLink, Mail, Loader2 } from "lucide-react";
import {
  useAdminApplications,
  useUpdateApplication,
  type AdminApplication,
  type ApplicationStatus,
  type LoiStatus,
} from "../adminApi";

const STATUS_OPTIONS: ApplicationStatus[] = [
  "new",
  "contacted",
  "onboarded",
  "declined",
];
const LOI_OPTIONS: LoiStatus[] = ["not_asked", "asked", "signed", "declined"];

const STATUS_LABEL: Record<ApplicationStatus, string> = {
  new: "New",
  contacted: "Contacted",
  onboarded: "Onboarded",
  declined: "Declined",
};
const LOI_LABEL: Record<LoiStatus, string> = {
  not_asked: "Not asked",
  asked: "Asked",
  signed: "Signed",
  declined: "Declined",
};

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function ApplicationsTable() {
  const { data, isLoading, error } = useAdminApplications();
  const mutate = useUpdateApplication();

  if (isLoading) {
    return (
      <div className="rounded-2xl bg-white border border-[var(--color-border-default)] p-8 flex items-center justify-center text-[var(--color-text-muted)]">
        <Loader2 className="w-4 h-4 animate-spin mr-2" />
        Loading applications…
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-2xl bg-white border border-[var(--color-border-default)] p-6 text-[13px] text-[#B91C1C]">
        Could not load applications: {error.message}
      </div>
    );
  }

  const items = data ?? [];

  return (
    <div className="rounded-2xl bg-white border border-[var(--color-border-default)] overflow-hidden">
      <header className="flex items-center justify-between px-5 py-4 border-b border-[var(--color-border-subtle)]">
        <div>
          <h2
            className="text-[16px] font-semibold text-[var(--color-text-primary)]"
            style={{ fontFamily: "var(--font-heading)" }}
          >
            Design partner applications
          </h2>
          <p className="text-[12.5px] text-[var(--color-text-muted)] mt-0.5">
            Triage incoming partners. Click a status to move them through the
            funnel.
          </p>
        </div>
        <span className="text-[12px] text-[var(--color-text-muted)] tabular-nums">
          {items.length} total
        </span>
      </header>

      {items.length === 0 ? (
        <div className="px-5 py-10 text-center text-[13px] text-[var(--color-text-muted)]">
          No applications yet. When founders submit the /apply form they appear
          here.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-[0.16em] text-[var(--color-text-muted)] border-b border-[var(--color-border-subtle)]">
                <th className="py-2.5 px-5">Applicant</th>
                <th className="py-2.5 px-4">App</th>
                <th className="py-2.5 px-4">Status</th>
                <th className="py-2.5 px-4">LOI</th>
                <th className="py-2.5 px-4">Submitted</th>
              </tr>
            </thead>
            <tbody>
              {items.map((app) => (
                <ApplicationRow
                  key={app.id}
                  application={app}
                  pending={mutate.isPending}
                  onUpdate={(patch) =>
                    mutate.mutate({ id: app.id, patch })
                  }
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

interface RowProps {
  application: AdminApplication;
  pending: boolean;
  onUpdate: (patch: {
    status?: ApplicationStatus;
    loiStatus?: LoiStatus;
  }) => void;
}

function ApplicationRow({ application, pending, onUpdate }: RowProps) {
  return (
    <tr className="border-b border-[var(--color-border-subtle)] last:border-b-0 align-top">
      <td className="py-3 px-5">
        <div className="font-semibold text-[var(--color-text-primary)]">
          {application.name}
        </div>
        <a
          href={`mailto:${application.email}`}
          className="inline-flex items-center gap-1 text-[12px] text-[var(--color-text-secondary)] hover:underline"
        >
          <Mail className="w-3 h-3" />
          {application.email}
        </a>
        {application.whyNow ? (
          <p className="mt-1 text-[12px] text-[var(--color-text-muted)] max-w-[320px] line-clamp-3">
            {application.whyNow}
          </p>
        ) : null}
      </td>
      <td className="py-3 px-4">
        <div className="font-medium text-[var(--color-text-primary)]">
          {application.appName}
        </div>
        {application.playStoreUrl ? (
          <a
            href={application.playStoreUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center gap-1 text-[12px] text-[var(--color-accent)] hover:underline"
          >
            Play Store <ExternalLink className="w-3 h-3" />
          </a>
        ) : null}
      </td>
      <td className="py-3 px-4">
        <select
          aria-label="Application status"
          className="bg-white border border-[var(--color-border-default)] rounded-md px-2 py-1 text-[12.5px] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-ring)]"
          value={application.status}
          disabled={pending}
          onChange={(e) =>
            onUpdate({ status: e.target.value as ApplicationStatus })
          }
        >
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s]}
            </option>
          ))}
        </select>
      </td>
      <td className="py-3 px-4">
        <select
          aria-label="LOI status"
          className="bg-white border border-[var(--color-border-default)] rounded-md px-2 py-1 text-[12.5px] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-ring)]"
          value={application.loiStatus}
          disabled={pending}
          onChange={(e) =>
            onUpdate({ loiStatus: e.target.value as LoiStatus })
          }
        >
          {LOI_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {LOI_LABEL[s]}
            </option>
          ))}
        </select>
      </td>
      <td className="py-3 px-4 text-[12px] text-[var(--color-text-muted)] whitespace-nowrap">
        {formatDate(application.createdAt)}
      </td>
    </tr>
  );
}
