import { cn } from "@/lib/utils";
import { forwardRef, type InputHTMLAttributes, type TextareaHTMLAttributes } from "react";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        "h-10 w-full rounded px-3 text-sm border border-[var(--color-neutral-300)] bg-white",
        "placeholder:text-[var(--color-neutral-400)] focus:outline-none focus:border-black",
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
        "w-full rounded px-3 py-2 text-sm border border-[var(--color-neutral-300)] bg-white",
        "placeholder:text-[var(--color-neutral-400)] focus:outline-none focus:border-black",
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

export function Select({ className, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        "h-10 w-full rounded px-3 text-sm border border-[var(--color-neutral-300)] bg-white",
        "focus:outline-none focus:border-black",
        className
      )}
      {...props}
    />
  );
}
