import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion, useReducedMotion } from "framer-motion";
import { ArrowRight, Menu, X } from "lucide-react";

const NAV_LINKS = [
  { label: "Features", href: "#features" },
  { label: "Pricing", href: "#pricing" },
  { label: "FAQ", href: "#faq" },
] as const;

export function NavBar() {
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);
  const reduceMotion = useReducedMotion();

  function scrollTo(href: string) {
    setMobileOpen(false);
    const el = document.querySelector(href);
    el?.scrollIntoView({ behavior: "smooth" });
  }

  function goLogin() {
    setMobileOpen(false);
    navigate("/login");
  }

  return (
    <motion.nav
      initial={reduceMotion ? false : { y: -8, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.4, ease: [0.22, 0.61, 0.36, 1] }}
      className="sticky top-0 inset-x-0 z-50 w-full"
      style={{
        background: "rgba(255, 255, 255, 0.96)",
        borderBottom: "1px solid var(--color-border-default)",
      }}
    >
      <div className="mx-auto max-w-[1120px] h-16 px-6 flex items-center justify-between">
        <button
          onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
          className="text-lg font-bold text-text-primary cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 rounded-sm"
          style={{ letterSpacing: "-0.02em", fontFamily: "var(--font-sans)" }}
          aria-label="ProdScope home"
        >
          prodscope
          <span style={{ color: "var(--color-accent)" }}>.</span>
        </button>

        <div className="hidden md:flex items-center gap-8">
          {NAV_LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              onClick={(e) => {
                e.preventDefault();
                scrollTo(link.href);
              }}
              className="text-sm font-medium text-text-secondary hover:text-text-primary transition-colors duration-200 cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 rounded-sm"
            >
              {link.label}
            </a>
          ))}
        </div>

        <div className="hidden md:flex items-center">
          <button
            onClick={goLogin}
            className="text-sm font-semibold text-white rounded-full inline-flex items-center gap-1.5 cursor-pointer transition-[filter] duration-150 hover:brightness-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
            style={{
              background: "var(--color-accent)",
              padding: "10px 18px",
            }}
          >
            Try free
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>

        <button
          onClick={() => setMobileOpen((v) => !v)}
          className="md:hidden p-2 text-text-primary cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 rounded-sm"
          aria-label={mobileOpen ? "Close menu" : "Open menu"}
          aria-expanded={mobileOpen}
        >
          {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>
      </div>

      {mobileOpen && (
        <motion.div
          role="dialog"
          aria-label="Mobile navigation"
          initial={reduceMotion ? false : { opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
          className="md:hidden bg-bg-primary border-t border-border-default px-6 pb-6 pt-2"
        >
          <div className="flex flex-col gap-1">
            {NAV_LINKS.map((link) => (
              <a
                key={link.href}
                href={link.href}
                onClick={(e) => {
                  e.preventDefault();
                  scrollTo(link.href);
                }}
                className="text-left text-sm font-medium text-text-secondary hover:text-text-primary py-3 transition-colors duration-200 cursor-pointer"
              >
                {link.label}
              </a>
            ))}
            <div className="border-t border-border-default mt-2 pt-4">
              <button
                onClick={goLogin}
                className="w-full text-sm font-semibold text-white rounded-full inline-flex items-center justify-center gap-1.5 cursor-pointer transition-[filter] duration-150 hover:brightness-95"
                style={{
                  background: "var(--color-accent)",
                  padding: "12px 18px",
                }}
              >
                Try free
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </motion.div>
      )}
    </motion.nav>
  );
}
