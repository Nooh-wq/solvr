"use client";

// M21.1 — Appearance tab: theme picker only (extracted from the old
// ProfileForm). Theme persistence is still local (next-themes
// localStorage) — server-side theme, density, and default landing page
// ship in M21.5, which will fold those columns from SubjectPreference
// into the same UI.

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";

const THEME_OPTIONS: { value: "light" | "dark" | "system"; label: string }[] = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System" },
];

export function AppearanceTab() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  /* eslint-disable react-hooks/set-state-in-effect -- one-time client-mount latch, same as sidebar.tsx */
  useEffect(() => setMounted(true), []);
  /* eslint-enable react-hooks/set-state-in-effect */

  return (
    <div className="space-y-6 max-w-xl">
      <div className="bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl p-6 space-y-4">
        <h2 className="text-[15px] font-semibold">Theme</h2>
        <p className="text-[13px] text-[var(--color-neutral-600)]">
          Choose how solvr looks on this device.
        </p>
        <div className="flex gap-2">
          {THEME_OPTIONS.map((opt) => {
            const active = mounted && theme === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => setTheme(opt.value)}
                className={`flex-1 h-9 rounded-xl text-[13px] font-medium border transition-colors duration-150 cursor-pointer ${
                  active
                    ? "bg-[var(--color-primary)] text-white border-[var(--color-primary)]"
                    : "bg-transparent border-[var(--color-neutral-300)] text-[var(--color-neutral-700)] hover:bg-[var(--color-light-gray)]"
                }`}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="bg-[var(--color-surface)] border border-dashed border-[var(--color-neutral-300)] rounded-2xl p-6 space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-[15px] font-semibold">Density &amp; default landing</h2>
          <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-neutral-500)]">
            Coming soon
          </span>
        </div>
        <p className="text-[13px] text-[var(--color-neutral-600)]">
          Compact/regular density and the default landing page ship in M21.5, alongside
          server-persisted theme sync across devices.
        </p>
      </div>
    </div>
  );
}
