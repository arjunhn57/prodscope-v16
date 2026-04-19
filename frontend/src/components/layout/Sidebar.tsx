import { NavLink, useNavigate } from "react-router-dom";
import {
  LayoutDashboard,
  Upload,
  Activity,
  Settings,
  LogOut,
  Bug,
  Menu,
  X,
  CreditCard,
  Shield,
} from "lucide-react";
import { cn } from "../../lib/cn";
import { useAuthStore } from "../../stores/auth";
import { useState } from "react";
import { TierBadge } from "../shared/TierBadge";
import { UpgradeCTA } from "../shared/UpgradeCTA";

const baseNavItems = [
  { to: "/dashboard", icon: LayoutDashboard, label: "Dashboard" },
  { to: "/upload", icon: Upload, label: "New Analysis" },
  { to: "/pricing", icon: CreditCard, label: "Pricing" },
  { to: "/settings", icon: Settings, label: "Settings" },
];

const adminNavItem = {
  to: "/admin/partners",
  icon: Shield,
  label: "Admin",
};

export function Sidebar() {
  const logout = useAuthStore((s) => s.logout);
  const tier = useAuthStore((s) => s.tier);
  const user = useAuthStore((s) => s.user);
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);

  const navItems = user?.role === "admin"
    ? [...baseNavItems, adminNavItem]
    : baseNavItems;

  const handleLogout = () => {
    logout();
    navigate("/login");
  };

  const navContent = (
    <>
      {/* Logo + Tier */}
      <div className="flex items-center gap-2.5 px-3 mb-8">
        <div className="w-8 h-8 rounded-lg bg-accent-glow flex items-center justify-center">
          <Bug className="w-4.5 h-4.5 text-accent" />
        </div>
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-sm font-semibold text-text-primary tracking-tight">ProdScope</h1>
            <TierBadge />
          </div>
          <p className="text-[10px] text-text-muted">App Analysis</p>
        </div>
      </div>

      {/* Nav Links */}
      <nav className="flex-1 space-y-1">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            onClick={() => setMobileOpen(false)}
            className={({ isActive }) =>
              cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-all duration-200 group",
                isActive
                  ? "bg-accent-glow text-accent font-medium"
                  : "text-text-secondary hover:text-text-primary hover:bg-bg-tertiary"
              )
            }
            end={item.to === "/dashboard"}
          >
            <item.icon className="w-4 h-4 shrink-0" />
            <span>{item.label}</span>
          </NavLink>
        ))}
      </nav>

      {/* Upgrade CTA + System Status + Logout */}
      <div className="mt-auto space-y-2 pt-4 border-t border-border-default">
        {tier === "free" && (
          <UpgradeCTA variant="card" className="mb-2" />
        )}
        <div className="flex items-center gap-2 px-3 py-2">
          <Activity className="w-3.5 h-3.5 text-success" />
          <span className="text-xs text-text-muted">System Online</span>
        </div>
        <button
          onClick={handleLogout}
          className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-text-secondary hover:text-danger hover:bg-danger/5 transition-all duration-200 w-full cursor-pointer"
        >
          <LogOut className="w-4 h-4" />
          <span>Log out</span>
        </button>
      </div>
    </>
  );

  return (
    <>
      {/* Mobile hamburger */}
      <button
        onClick={() => setMobileOpen(!mobileOpen)}
        className="lg:hidden fixed top-4 left-4 z-50 p-2 rounded-xl bg-bg-secondary border border-border-default shadow-sm text-text-primary cursor-pointer"
      >
        {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
      </button>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="lg:hidden fixed inset-0 bg-black/20 z-40"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          "flex flex-col h-dvh p-4 border-r border-border-default bg-bg-secondary",
          "w-[220px] shrink-0",
          "fixed lg:sticky top-0 left-0 z-40 transition-transform duration-300 lg:translate-x-0",
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        {navContent}
      </aside>
    </>
  );
}
