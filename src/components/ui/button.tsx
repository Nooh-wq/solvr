import { cn } from "@/lib/utils";
import { type ButtonHTMLAttributes, forwardRef } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

const base =
  "inline-flex items-center justify-center gap-2 rounded-full font-medium transition-all duration-150 disabled:opacity-40 disabled:pointer-events-none whitespace-nowrap cursor-pointer active:scale-[0.97]";

const variants: Record<Variant, string> = {
  primary:
    "bg-[var(--color-primary)] text-white shadow-[0_4px_14px_-4px_var(--color-primary)] hover:bg-[var(--color-primary-hover)] hover:shadow-[0_6px_20px_-4px_var(--color-primary)] hover:-translate-y-px",
  secondary: "border border-[var(--foreground)] text-[var(--foreground)] hover:bg-[var(--color-light-gray)] hover:-translate-y-px",
  ghost: "text-[var(--foreground)] hover:bg-[var(--color-light-gray)]",
  danger: "border border-red-600 text-red-600 hover:bg-red-50",
};

const sizes: Record<Size, string> = {
  sm: "h-8 px-3.5 text-[13px]",
  md: "h-10 px-5 text-sm",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "primary", size = "md", ...props }, ref) => (
    <button ref={ref} className={cn(base, variants[variant], sizes[size], className)} {...props} />
  )
);
Button.displayName = "Button";
