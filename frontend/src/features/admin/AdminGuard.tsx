import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuthStore } from "../../stores/auth";

export function AdminGuard({ children }: { children: ReactNode }) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const user = useAuthStore((s) => s.user);
  const location = useLocation();

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (!user || user.role !== "admin") {
    return (
      <div className="min-h-dvh flex items-center justify-center bg-[#FAFAFA] px-6">
        <div className="max-w-md w-full rounded-2xl bg-white border border-[var(--color-border-default)] p-8 text-center">
          <h1
            className="text-[22px] font-semibold text-[var(--color-text-primary)]"
            style={{ fontFamily: "var(--font-heading)" }}
          >
            Admin access only
          </h1>
          <p
            className="mt-2 text-[14px] text-[var(--color-text-secondary)]"
            style={{ fontFamily: "var(--font-sans)" }}
          >
            This page is restricted to ProdScope administrators. If you believe
            you should have access, ask Arjun to add your email to ADMIN_EMAILS
            on the server.
          </p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
