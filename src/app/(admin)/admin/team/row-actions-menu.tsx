"use client";

import { useEffect, useRef, useState } from "react";
import { MoreVerticalIcon } from "@/components/icons";

export type RowMenuItem = {
  label: string;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
  disabledReason?: string;
};

export function RowActionsMenu({ items, ariaLabel }: { items: RowMenuItem[]; ariaLabel: string }) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const btnRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      const target = e.target as Node;
      if (menuRef.current?.contains(target)) return;
      if (btnRef.current?.contains(target)) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (items.length === 0) return null;

  return (
    <div className="relative inline-block">
      <button
        ref={btnRef}
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="h-8 w-8 flex items-center justify-center rounded-full text-[var(--color-neutral-500)] hover:bg-black/[0.045] dark:hover:bg-white/[0.06] hover:text-[var(--foreground)] transition-colors duration-150 cursor-pointer"
      >
        <MoreVerticalIcon className="h-4 w-4" />
      </button>
      {open && (
        <div
          ref={menuRef}
          role="menu"
          className="absolute right-0 top-full mt-1 z-30 min-w-[176px] bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-xl shadow-[0_8px_28px_-8px_rgba(0,0,0,0.16)] py-1 animate-[fadeIn_120ms_ease-out]"
        >
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              onClick={() => {
                if (item.disabled) return;
                item.onSelect();
                setOpen(false);
              }}
              title={item.disabled ? item.disabledReason : undefined}
              className={`w-full text-left px-3 py-1.5 text-[13px] transition-colors duration-100 ${
                item.disabled
                  ? "text-[var(--color-neutral-400)] cursor-not-allowed"
                  : item.danger
                  ? "text-red-600 hover:bg-red-500/10 cursor-pointer"
                  : "text-[var(--foreground)] hover:bg-black/[0.045] dark:hover:bg-white/[0.06] cursor-pointer"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
