import { motion } from "framer-motion";
import type { ReactNode, ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "ghost";

interface PremiumButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  icon?: ReactNode;
  children: ReactNode;
}

const VARIANTS: Record<Variant, React.CSSProperties> = {
  primary: {
    background: "var(--m-accent)",
    color: "var(--m-text-on-accent)",
    border: "none",
    boxShadow: "0 2px 8px rgba(3, 105, 161, 0.25), 0 1px 2px rgba(3, 105, 161, 0.15), inset 0 1px 0 rgba(255,255,255,0.15)",
  },
  secondary: {
    background: "var(--m-bg-white)",
    color: "var(--m-text)",
    border: "1px solid var(--m-border)",
    boxShadow: "var(--m-shadow-sm)",
  },
  ghost: {
    background: "transparent",
    color: "var(--m-text-secondary)",
    border: "1px solid transparent",
    boxShadow: "none",
  },
};

export function PremiumButton({
  variant = "primary",
  icon,
  children,
  ...props
}: PremiumButtonProps) {
  return (
    <motion.button
      whileHover={{ y: -1, scale: 1.01 }}
      whileTap={{ y: 0, scale: 0.98 }}
      transition={{ type: "spring", stiffness: 400, damping: 25 }}
      style={{
        ...VARIANTS[variant],
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        padding: "10px 20px",
        borderRadius: "var(--m-radius-md)",
        fontSize: 14,
        fontWeight: 600,
        fontFamily: "var(--m-font)",
        cursor: "pointer",
        transition: "background 0.2s ease, box-shadow 0.2s ease",
        lineHeight: 1,
      }}
      {...(props as Record<string, unknown>)}
    >
      {icon && <span style={{ display: "flex", width: 16, height: 16 }}>{icon}</span>}
      {children}
    </motion.button>
  );
}
