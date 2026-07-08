"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ChevronDownIcon } from "@/components/icons";

// shadcn-style dropdown built as a lightweight Radix-free component so the
// bundle doesn't gain a dependency for one interaction pattern. The visual
// language matches the Solvr palette (surface bg, neutral borders, primary
// accent for selected/focused item, subtle shadow); behaviour matches
// shadcn:
//   - trigger toggles the panel
//   - click-outside + Escape close
//   - Arrow keys navigate items, Enter/Space select, Home/End jump ends
//   - typeahead (letter keys) skips to items whose label starts with the
//     typed prefix, matching native <select> muscle memory
//
// Composable API mirrors shadcn (DropdownMenu / Trigger / Content / Item)
// but we ship one convenience wrapper (DropdownSelect) since 90% of the
// admin surface is really "swap a native <select> for a nicer floating
// list." Advanced menus (with sections, checkboxes, submenus) stay a
// direct DropdownMenu.* composition.

type Ctx = {
  open: boolean;
  setOpen: (v: boolean) => void;
  triggerId: string;
  contentId: string;
  triggerRef: React.MutableRefObject<HTMLButtonElement | null>;
};

const DropdownCtx = createContext<Ctx | null>(null);

function useDropdown() {
  const ctx = useContext(DropdownCtx);
  if (!ctx) throw new Error("Dropdown parts must be used inside <DropdownMenu>.");
  return ctx;
}

export function DropdownMenu({
  children,
  defaultOpen = false,
  className = "",
}: {
  children: ReactNode;
  defaultOpen?: boolean;
  /** Overrides the default `relative inline-block` wrapper — the
   *  DropdownSelect wrapper passes `relative block w-full` so its
   *  outer width class propagates all the way down to the trigger. */
  className?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const triggerId = useId();
  const contentId = useId();
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  return (
    <DropdownCtx.Provider value={{ open, setOpen, triggerId, contentId, triggerRef }}>
      <div className={className || "relative inline-block"}>{children}</div>
    </DropdownCtx.Provider>
  );
}

export function DropdownMenuTrigger({
  children,
  className = "",
  disabled = false,
}: {
  children: ReactNode;
  className?: string;
  disabled?: boolean;
}) {
  const { open, setOpen, triggerId, contentId, triggerRef } = useDropdown();
  return (
    <button
      type="button"
      id={triggerId}
      ref={triggerRef}
      aria-haspopup="menu"
      aria-expanded={open}
      aria-controls={contentId}
      disabled={disabled}
      onClick={() => setOpen(!open)}
      onKeyDown={(e) => {
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          e.preventDefault();
          setOpen(true);
        }
      }}
      className={
        `inline-flex items-center gap-1.5 h-9 px-3 rounded-lg text-[13px] bg-[var(--color-surface)] border border-[var(--color-neutral-300)] text-[var(--foreground)] transition-colors duration-150 cursor-pointer hover:border-[var(--color-neutral-400)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/25 focus:border-[var(--color-primary)]/50 disabled:cursor-not-allowed disabled:opacity-60 ` +
        className
      }
    >
      {children}
    </button>
  );
}

export function DropdownMenuContent({
  children,
  align = "start",
  className = "",
  minWidth,
}: {
  children: ReactNode;
  align?: "start" | "end";
  className?: string;
  /** Optional min-width override (px). Default: trigger's own width. */
  minWidth?: number;
}) {
  const { open, setOpen, triggerId, contentId, triggerRef } = useDropdown();
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [triggerWidth, setTriggerWidth] = useState<number | null>(null);
  const typeaheadRef = useRef<{ buffer: string; timer: ReturnType<typeof setTimeout> | null }>({
    buffer: "",
    timer: null,
  });

  // Match panel width to trigger for the "expanded select" look. Runs
  // whenever the menu opens.
  useEffect(() => {
    if (open && triggerRef.current) {
      setTriggerWidth(triggerRef.current.offsetWidth);
    }
  }, [open, triggerRef]);

  // Click-outside + Escape closers.
  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      const t = e.target as Node;
      if (panelRef.current?.contains(t)) return;
      if (triggerRef.current?.contains(t)) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, setOpen, triggerRef]);

  // Keyboard nav across item children — implemented at the panel level
  // so items can stay plain buttons instead of each managing focus.
  const focusItem = useCallback((dir: 1 | -1 | "first" | "last") => {
    if (!panelRef.current) return;
    const items = Array.from(
      panelRef.current.querySelectorAll<HTMLElement>('[role="menuitem"]:not([data-disabled="true"])')
    );
    if (items.length === 0) return;
    const activeIdx = items.findIndex((el) => el === document.activeElement);
    let nextIdx: number;
    if (dir === "first") nextIdx = 0;
    else if (dir === "last") nextIdx = items.length - 1;
    else {
      nextIdx = activeIdx === -1 ? (dir === 1 ? 0 : items.length - 1) : (activeIdx + dir + items.length) % items.length;
    }
    items[nextIdx].focus();
  }, []);

  useEffect(() => {
    if (open) {
      // Focus first item on open — matches shadcn.
      queueMicrotask(() => focusItem("first"));
    }
  }, [open, focusItem]);

  function onPanelKey(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      focusItem(1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      focusItem(-1);
    } else if (e.key === "Home") {
      e.preventDefault();
      focusItem("first");
    } else if (e.key === "End") {
      e.preventDefault();
      focusItem("last");
    } else if (e.key === "Tab") {
      // Trap Tab inside the menu — same behaviour as shadcn's Radix impl.
      setOpen(false);
    } else if (e.key.length === 1 && /[a-z0-9]/i.test(e.key)) {
      // Typeahead.
      const ta = typeaheadRef.current;
      ta.buffer += e.key.toLowerCase();
      if (ta.timer) clearTimeout(ta.timer);
      ta.timer = setTimeout(() => {
        ta.buffer = "";
      }, 500);
      const items = Array.from(
        panelRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([data-disabled="true"])') ?? []
      );
      const match = items.find((el) => el.textContent?.trim().toLowerCase().startsWith(ta.buffer));
      if (match) match.focus();
    }
  }

  if (!open) return null;

  return (
    <div
      ref={panelRef}
      id={contentId}
      role="menu"
      aria-labelledby={triggerId}
      onKeyDown={onPanelKey}
      style={{ minWidth: minWidth ?? triggerWidth ?? undefined }}
      className={
        `absolute z-50 mt-1 ${align === "end" ? "right-0" : "left-0"} ` +
        `origin-top-${align === "end" ? "right" : "left"} ` +
        `rounded-lg border border-[var(--color-neutral-300)] bg-[var(--color-surface)] ` +
        `shadow-lg shadow-black/[0.06] dark:shadow-black/40 py-1 ` +
        // overflow-x-hidden — long option labels truncate at the item level
        // (see the `truncate` class on the label span in DropdownMenuItem),
        // so there's never a need for a horizontal scrollbar and the extra
        // rail was pure noise. Vertical rides the shared thin-scrollbar
        // style so it visually matches the sidebar.
        `max-h-72 overflow-y-auto overflow-x-hidden thin-scrollbar ` +
        className
      }
    >
      {children}
    </div>
  );
}

export function DropdownMenuItem({
  children,
  onSelect,
  disabled = false,
  selected = false,
  className = "",
}: {
  children: ReactNode;
  onSelect?: () => void;
  disabled?: boolean;
  /** Adds the accent tick + tint for the current selection. */
  selected?: boolean;
  className?: string;
}) {
  const { setOpen } = useDropdown();
  return (
    <button
      type="button"
      role="menuitem"
      data-disabled={disabled}
      disabled={disabled}
      onClick={() => {
        if (disabled) return;
        onSelect?.();
        setOpen(false);
      }}
      className={
        `w-full text-left flex items-center gap-2 px-2.5 py-1.5 text-[13px] rounded-md mx-1 ` +
        `text-[var(--foreground)] transition-colors duration-100 cursor-pointer ` +
        `hover:bg-[var(--color-neutral-100)] focus:bg-[var(--color-neutral-100)] focus:outline-none ` +
        `disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent ` +
        (selected ? `bg-[var(--color-primary)]/8 text-[var(--color-primary)] font-medium ` : ``) +
        className
      }
    >
      {selected && (
        <svg viewBox="0 0 20 20" className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth={2}>
          <path d="M4 10.5 8 14 16 6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
      {!selected && <span className="w-3.5 shrink-0" aria-hidden="true" />}
      <span className="truncate">{children}</span>
    </button>
  );
}

export function DropdownMenuSeparator() {
  return <div className="my-1 h-px bg-[var(--color-neutral-200)] dark:bg-white/10" role="separator" />;
}

export function DropdownMenuLabel({ children }: { children: ReactNode }) {
  return (
    <div className="px-3 py-1 text-[10px] uppercase tracking-wider text-[var(--color-neutral-500)] font-medium">
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Convenience wrapper — replaces the vast majority of native <select> usage
// with one prop-driven component. Callers who need a header/separator/etc
// drop down a level to the composable primitives above.
// ---------------------------------------------------------------------------

export type DropdownSelectOption = {
  value: string;
  label: string;
  hint?: string;
  disabled?: boolean;
};

export function DropdownSelect({
  value,
  onChange,
  options,
  placeholder = "Select…",
  className = "",
  triggerClassName = "",
  disabled = false,
  ariaLabel,
  align = "start",
}: {
  value: string;
  onChange: (next: string) => void;
  options: DropdownSelectOption[];
  placeholder?: string;
  className?: string;
  triggerClassName?: string;
  disabled?: boolean;
  ariaLabel?: string;
  align?: "start" | "end";
}) {
  const current = useMemo(() => options.find((o) => o.value === value), [options, value]);
  return (
    <div className={className}>
      <DropdownMenu className="relative block w-full">
        <DropdownMenuTrigger
          className={`justify-between w-full ${triggerClassName}`}
          disabled={disabled}
        >
          <span
            aria-label={ariaLabel}
            className={`truncate ${current ? "" : "text-[var(--color-neutral-500)]"}`}
          >
            {current?.label ?? placeholder}
          </span>
          <ChevronDownIcon className="h-3.5 w-3.5 text-[var(--color-neutral-500)] shrink-0" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align={align}>
          {options.map((o) => (
            <DropdownMenuItem
              key={o.value}
              onSelect={() => onChange(o.value)}
              disabled={o.disabled}
              selected={o.value === value}
            >
              <span className="flex-1 truncate">{o.label}</span>
              {o.hint && (
                <span className="text-[11px] text-[var(--color-neutral-500)] ml-2 shrink-0">
                  {o.hint}
                </span>
              )}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
