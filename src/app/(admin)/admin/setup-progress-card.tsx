"use client";

// Landing dashboard card — setup checklist. Client component so it can
// self-dismiss via localStorage per spec ("Dismissible after tenant is
// beyond initial setup").

import { useState, useSyncExternalStore } from "react";
import Link from "next/link";

const DISMISS_KEY = "solvr:admin-setup-dismissed";

function subscribe(onStoreChange: () => void) {
  window.addEventListener("storage", onStoreChange);
  return () => window.removeEventListener("storage", onStoreChange);
}

type SetupState = {
  brandingConfigured: boolean;
  ssoConfigured: boolean;
  hasCustomField: boolean;
  hasRule: boolean;
  hasBusinessCalendar: boolean;
  doneCount: number;
  totalCount: number;
};

const ITEMS: Array<{ key: keyof SetupState; label: string; href: string }> = [
  { key: "brandingConfigured", label: "Set up branding", href: "/admin/branding" },
  { key: "ssoConfigured", label: "Configure SSO", href: "/admin/identity-providers" },
  { key: "hasCustomField", label: "Create your first custom field", href: "/admin/fields" },
  { key: "hasRule", label: "Set up your first workflow", href: "/admin/triggers" },
  { key: "hasBusinessCalendar", label: "Configure business hours", href: "/admin/business-calendars" },
];

export function SetupProgressCard({ setup }: { setup: SetupState }) {
  // Stored dismissal is read hydration-safely via useSyncExternalStore;
  // justDismissed covers the same-tab click (localStorage writes don't
  // fire "storage" in the tab that made them).
  const stored = useSyncExternalStore(
    subscribe,
    () => localStorage.getItem(DISMISS_KEY),
    () => null
  );
  const [justDismissed, setJustDismissed] = useState(false);
  const dismissed = stored === "true" || justDismissed;
  function dismiss() {
    try {
      localStorage.setItem(DISMISS_KEY, "true");
    } catch {
      /* ignore */
    }
    setJustDismissed(true);
  }
  if (dismissed) return null;
  const pct = Math.round((setup.doneCount / setup.totalCount) * 100);
  return (
    <div className="bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl p-5">
      <div className="flex items-start justify-between mb-3">
        <h2 className="text-[13px] font-semibold">Setup progress</h2>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-[var(--color-neutral-500)]">
            {setup.doneCount} / {setup.totalCount} · {pct}%
          </span>
          {setup.doneCount === setup.totalCount ? (
            <button onClick={dismiss} className="text-[11px] underline text-[var(--color-neutral-600)]">
              Dismiss
            </button>
          ) : null}
        </div>
      </div>
      <ul className="space-y-1.5">
        {ITEMS.map((i) => {
          const done = Boolean(setup[i.key]);
          return (
            <li key={i.key} className="flex items-center gap-2 text-[13px]">
              <span
                className={`inline-block h-4 w-4 rounded-full flex items-center justify-center text-[10px] ${
                  done ? "bg-emerald-500 text-white" : "border border-[var(--color-neutral-300)]"
                }`}
                aria-hidden
              >
                {done ? "✓" : ""}
              </span>
              {done ? (
                <span className="text-[var(--color-neutral-500)] line-through">{i.label}</span>
              ) : (
                <Link href={i.href} className="hover:underline">
                  {i.label}
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
