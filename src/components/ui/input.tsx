import { cn } from "@/lib/utils";
import { forwardRef, type InputHTMLAttributes, type TextareaHTMLAttributes } from "react";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        "h-10 w-full rounded-xl px-3 text-sm border border-[var(--color-neutral-300)] bg-[var(--color-surface)] text-[var(--foreground)]",
        "placeholder:text-[var(--color-neutral-400)] focus:outline-none focus:border-[var(--foreground)]",
        className
      )}
      {...props}
    />
  )
);
Input.displayName = "Input";

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        "w-full rounded-xl px-3 py-2 text-sm border border-[var(--color-neutral-300)] bg-[var(--color-surface)] text-[var(--foreground)]",
        "placeholder:text-[var(--color-neutral-400)] focus:outline-none focus:border-[var(--foreground)]",
        className
      )}
      {...props}
    />
  )
);
Textarea.displayName = "Textarea";

export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      className={cn("uppercase-label text-[11px] font-semibold text-[var(--color-neutral-700)]", className)}
      {...props}
    />
  );
}

/**
 * Solid Select. Wraps a native <select> — kept native for accessibility
 * and the platform's option list — but with a custom chevron so caret
 * spacing stays consistent across browsers. Surface + border match the
 * rest of the design system (cards, inputs). Options inherit the
 * current color-scheme so the popup is readable in both themes.
 */
export function Select({ className, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  // Caller className goes on the wrapper AND the inner select so
  // width / height / margin utilities (`h-9`, `w-40`, `mt-1`, …)
  // resize the whole control while text/color utilities still hit
  // the select itself. Inner defaults are w-full/h-full so a wrapper
  // sized via className fills correctly.
  return (
    <div className={cn("relative h-10 w-full", className)}>
      <select
        className={cn(
          "appearance-none h-full w-full rounded-xl pl-3 pr-9 text-sm",
          "border border-[var(--color-neutral-300)] bg-[var(--color-surface)] text-[var(--foreground)]",
          "focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30 focus:border-[var(--color-primary)]/60",
          "transition-colors cursor-pointer",
          "disabled:opacity-60 disabled:cursor-not-allowed",
          // Zero the space Safari reserves for its native caret.
          "[&::-ms-expand]:hidden",
          // Follow the current color-scheme so the native option
          // popup renders as dark-on-dark or light-on-light, not
          // pale grey text on a light popup inside our dark shell.
          "[color-scheme:light_dark]",
          // Explicit option colors + padding so the popup rows have
          // breathing room instead of hugging the option box edges,
          // and stay readable in browsers that don't yet honor
          // color-scheme on <select>.
          "[&>option]:bg-[var(--color-surface)] [&>option]:text-[var(--foreground)] [&>option]:py-1.5",
          className
        )}
        {...props}
      />
      {/* Custom chevron — absolutely positioned so it always sits with
          a fixed gap from the right edge regardless of the select's
          content width or the browser's native caret behaviour. */}
      <svg
        aria-hidden="true"
        viewBox="0 0 20 20"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--color-neutral-500)]"
      >
        <path d="m6 8 4 4 4-4" />
      </svg>
    </div>
  );
}
