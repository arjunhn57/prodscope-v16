import { Loader2, AlertTriangle } from "lucide-react";
import {
  useAdminUsers,
  useUpdateUserRole,
  type AdminRole,
  type AdminUser,
} from "../adminApi";

const ROLE_OPTIONS: AdminRole[] = ["public", "design_partner", "admin"];
const ROLE_LABEL: Record<AdminRole, string> = {
  public: "Public",
  design_partner: "Partner",
  admin: "Admin",
};

const HIGH_SPEND_THRESHOLD_USD = 5;

function formatUsd(value: number): string {
  if (!Number.isFinite(value) || value === 0) return "$0.00";
  if (value < 1) return `$${value.toFixed(4)}`;
  return `$${value.toFixed(2)}`;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

export function UsersTable() {
  const { data, isLoading, error } = useAdminUsers();
  const mutate = useUpdateUserRole();

  if (isLoading) {
    return (
      <div className="rounded-2xl bg-white border border-[var(--color-border-default)] p-8 flex items-center justify-center text-[var(--color-text-muted)]">
        <Loader2 className="w-4 h-4 animate-spin mr-2" />
        Loading users…
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-2xl bg-white border border-[var(--color-border-default)] p-6 text-[13px] text-[#B91C1C]">
        Could not load users: {error.message}
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
            Users and usage
          </h2>
          <p className="text-[12.5px] text-[var(--color-text-muted)] mt-0.5">
            Per-user cost + crawl count, sorted by spend. Bump a partner to{" "}
            <span className="font-medium">Partner</span> after they submit their
            first crawl.
          </p>
        </div>
        <span className="text-[12px] text-[var(--color-text-muted)] tabular-nums">
          {items.length} total
        </span>
      </header>

      {items.length === 0 ? (
        <div className="px-5 py-10 text-center text-[13px] text-[var(--color-text-muted)]">
          No users yet. Everyone who signs in with Google lands here.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-[0.16em] text-[var(--color-text-muted)] border-b border-[var(--color-border-subtle)]">
                <th className="py-2.5 px-5">User</th>
                <th className="py-2.5 px-4">Role</th>
                <th className="py-2.5 px-4 text-right">Crawls</th>
                <th className="py-2.5 px-4 text-right">Total spend</th>
                <th className="py-2.5 px-4">Last crawl</th>
                <th className="py-2.5 px-4">LOI</th>
              </tr>
            </thead>
            <tbody>
              {items.map((u) => (
                <UserRow
                  key={u.id}
                  user={u}
                  pending={mutate.isPending}
                  onRoleChange={(role) => mutate.mutate({ id: u.id, role })}
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
  user: AdminUser;
  pending: boolean;
  onRoleChange: (role: AdminRole) => void;
}

function UserRow({ user, pending, onRoleChange }: RowProps) {
  const highSpend = user.totalCostUsd > HIGH_SPEND_THRESHOLD_USD;
  return (
    <tr className="border-b border-[var(--color-border-subtle)] last:border-b-0 align-middle">
      <td className="py-3 px-5">
        <div className="font-semibold text-[var(--color-text-primary)]">
          {user.name || user.email}
        </div>
        {user.name ? (
          <div className="text-[12px] text-[var(--color-text-secondary)]">
            {user.email}
          </div>
        ) : null}
      </td>
      <td className="py-3 px-4">
        <select
          aria-label="User role"
          className="bg-white border border-[var(--color-border-default)] rounded-md px-2 py-1 text-[12.5px] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-ring)]"
          value={user.role}
          disabled={pending}
          onChange={(e) => onRoleChange(e.target.value as AdminRole)}
        >
          {ROLE_OPTIONS.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABEL[r]}
            </option>
          ))}
        </select>
      </td>
      <td className="py-3 px-4 text-right tabular-nums">{user.crawlCount}</td>
      <td className="py-3 px-4 text-right tabular-nums">
        <span
          className={`inline-flex items-center gap-1 ${
            highSpend ? "text-[#B91C1C] font-semibold" : ""
          }`}
        >
          {highSpend ? <AlertTriangle className="w-3 h-3" /> : null}
          {formatUsd(user.totalCostUsd)}
        </span>
      </td>
      <td className="py-3 px-4 text-[12px] text-[var(--color-text-muted)] whitespace-nowrap">
        {formatDate(user.lastCrawlAt)}
      </td>
      <td className="py-3 px-4 text-[12px] text-[var(--color-text-muted)] whitespace-nowrap">
        {user.loiStatus
          ? user.loiStatus === "signed"
            ? (
              <span className="text-[#059669] font-semibold">Signed</span>
            )
            : user.loiStatus.replace(/_/g, " ")
          : "—"}
      </td>
    </tr>
  );
}
