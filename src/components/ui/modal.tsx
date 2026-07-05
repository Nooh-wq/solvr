"use client";

import { useEffect } from "react";
import { CloseIcon } from "@/components/icons";

/**
 * Centered modal dialog with a glass backdrop. Closes on Escape and on
 * backdrop click. Renders nothing when `open` is false, so callers can mount
 * it unconditionally and just flip the flag.
 */
export function Modal({
  open,
  onClose,
  title,
  children,
  widthClass = "max-w-md",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  widthClass?: string;
}) {
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    // Lock background scroll while open.
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30 backdrop-blur-[2px] animate-[fadeIn_150ms_ease-out]"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        className={`w-full ${widthClass} bg-[var(--color-surface)]/90 backdrop-blur-xl border border-white/60 dark:border-white/10 rounded-2xl shadow-[0_24px_64px_-16px_rgba(0,0,0,0.35)] overflow-hidden animate-[fadeIn_150ms_ease-out]`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-black/5 dark:border-white/10">
          <h2 className="text-[15px] font-semibold text-[var(--foreground)]">{title}</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="h-8 w-8 flex items-center justify-center rounded-full text-[var(--color-neutral-600)] hover:bg-black/[0.05] dark:hover:bg-white/[0.08] hover:text-[var(--foreground)] transition-colors duration-150 cursor-pointer"
          >
            <CloseIcon className="h-4 w-4" />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}
