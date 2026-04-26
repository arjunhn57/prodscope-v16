import { Navigate, useLocation } from "react-router-dom";
import { useAuthStore } from "../../stores/auth";

// Temporary guest-mode bypass (set VITE_GUEST_MODE=true in .env.production).
// When on, AuthGuard is a passthrough — paired with backend's
// GUEST_MODE_ENABLED flag which admits unauthenticated requests as a
// synthetic admin user. Off by default; flip both flags off to restore
// the real login gate.
const GUEST_MODE = import.meta.env.VITE_GUEST_MODE === "true";

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const location = useLocation();

  if (GUEST_MODE) return <>{children}</>;

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return <>{children}</>;
}
