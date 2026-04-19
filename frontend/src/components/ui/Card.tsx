import { type HTMLAttributes } from "react";
import { cn } from "../../lib/cn";

type CardVariant = "card" | "muted" | "accent";

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  variant?: CardVariant;
}

const variantClass: Record<CardVariant, string> = {
  card: "surface-card",
  muted: "surface-muted",
  accent: "surface-accent",
};

export function Card({ variant = "card", className, children, ...props }: CardProps) {
  return (
    <div className={cn("p-5", variantClass[variant], className)} {...props}>
      {children}
    </div>
  );
}

export function CardHeader({ className, children, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("flex items-center justify-between mb-4", className)} {...props}>
      {children}
    </div>
  );
}

export function CardTitle({ className, children, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3 className={cn("text-sm font-medium text-text-secondary", className)} {...props}>
      {children}
    </h3>
  );
}
