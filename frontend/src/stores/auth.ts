import { create } from "zustand";
import { persist } from "zustand/middleware";

export type Tier = "free" | "pro" | "enterprise";

export type UserRole = "public" | "design_partner" | "admin";

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  picture: string;
  role: UserRole;
}

export type GatedFeature =
  | "full_findings"
  | "coverage_breakdown"
  | "app_map_interactive"
  | "screenshot_gallery"
  | "recommendations"
  | "export"
  | "comparison_view"
  | "testing_focus_payment"
  | "testing_focus_accessibility"
  | "testing_focus_crash"
  | "quick_insights"
  | "priority_queue";

interface Usage {
  crawlsThisMonth: number;
  crawlLimit: number;
}

interface AuthState {
  token: string | null;
  user: AuthUser | null;
  isAuthenticated: boolean;
  tier: Tier;
  usage: Usage;
  login: (token: string, user?: AuthUser | null) => void;
  logout: () => void;
}

export const FREE_USAGE: Usage = { crawlsThisMonth: 0, crawlLimit: 3 };
export const PRO_USAGE: Usage = { crawlsThisMonth: 0, crawlLimit: 25 };
export const ENTERPRISE_USAGE: Usage = { crawlsThisMonth: 0, crawlLimit: Infinity };

export const TIER_USAGE: Record<Tier, Usage> = {
  free: FREE_USAGE,
  pro: PRO_USAGE,
  enterprise: ENTERPRISE_USAGE,
};

const PRO_FEATURES: GatedFeature[] = [
  "full_findings",
  "coverage_breakdown",
  "app_map_interactive",
  "screenshot_gallery",
  "recommendations",
  "export",
  "comparison_view",
  "quick_insights",
];

const ENTERPRISE_EXTRAS: GatedFeature[] = [
  "priority_queue",
  "testing_focus_payment",
  "testing_focus_accessibility",
  "testing_focus_crash",
];

const TIER_FEATURES: Record<Tier, Set<GatedFeature>> = {
  free: new Set(),
  pro: new Set(PRO_FEATURES),
  enterprise: new Set<GatedFeature>([...PRO_FEATURES, ...ENTERPRISE_EXTRAS]),
};

export function canAccessFeature(tier: Tier, feature: GatedFeature): boolean {
  return TIER_FEATURES[tier].has(feature);
}

/**
 * Derive a client tier from the server-issued role. During the private beta
 * there is no self-serve billing — admins and design partners get full feature
 * access, public visitors get the free tier. This is display-only — real
 * enforcement ships with Stripe. Keeping tier in sync with role lets gated
 * UI components stay unchanged across the billing migration.
 */
function tierFromRole(role: UserRole | undefined | null): Tier {
  if (role === "admin" || role === "design_partner") return "enterprise";
  return "free";
}

function usageFromRole(role: UserRole | undefined | null): Usage {
  return TIER_USAGE[tierFromRole(role)];
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      user: null,
      isAuthenticated: false,
      tier: "free" as Tier,
      usage: FREE_USAGE,
      login: (token, user = null) =>
        set({
          token,
          user,
          isAuthenticated: true,
          tier: tierFromRole(user?.role),
          usage: usageFromRole(user?.role),
        }),
      logout: () =>
        set({
          token: null,
          user: null,
          isAuthenticated: false,
          tier: "free",
          usage: FREE_USAGE,
        }),
    }),
    { name: "prodscope-auth" }
  )
);
