"use client";

// M21.5 — Appearance tab. Theme, density, and default landing page all
// persist server-side (SubjectPreference) so they sync across devices —
// see also ThemeSync/DensitySync in components/theme-provider.tsx.
//
// The theme selector still calls next-themes' setTheme() locally so the
// current-device paint updates immediately; the server write happens in
// the background. On the next device (or next reload here), root layout
// reads the server value and pushes it into next-themes.

import { useEffect, useState, useTransition } from "react";
import { useTheme } from "next-themes";
import {
  getMyPreferences,
  updateMyPreferences,
  type PreferencesDto,
} from "@/actions/preferences";
import { useToast } from "@/components/ui/toast";
import type { UserRole as Role } from "@/lib/auth";

const THEME_OPTIONS: { value: "light" | "dark" | "system"; label: string }[] = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System" },
];

const DENSITY_OPTIONS: { value: "regular" | "compact"; label: string }[] = [
  { value: "regular", label: "Regular" },
  { value: "compact", label: "Compact" },
];

const LANDING_BY_ROLE: Record<Role, Array<{ value: string; label: string }>> = {
  CLIENT: [
    { value: "/portal", label: "My tickets" },
    { value: "/portal/new", label: "New ticket" },
  ],
  AGENT: [
    { value: "/agent", label: "Queue" },
    { value: "/portal", label: "Portal" },
  ],
  ADMIN: [
    { value: "/admin", label: "Overview" },
    { value: "/admin/analytics", label: "Analytics" },
    { value: "/agent", label: "Queue" },
  ],
  SUPER_ADMIN: [
    { value: "/admin/super", label: "Super admin" },
    { value: "/admin", label: "Overview" },
    { value: "/admin/analytics", label: "Analytics" },
  ],
};

export function AppearanceTab({ role }: { role: Role }) {
  const { toast } = useToast();
  const { theme, setTheme } = useTheme();
  const [prefs, setPrefs] = useState<PreferencesDto | null>(null);
  const [mounted, setMounted] = useState(false);
  const [pending, startTransition] = useTransition();

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    setMounted(true);
    (async () => setPrefs(await getMyPreferences()))();
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  function apply(patch: Partial<PreferencesDto>) {
    if (!prefs) return;
    const next = { ...prefs, ...patch };
    setPrefs(next);
    // Density gets its data-attribute pushed immediately so the change is
    // visible before the server round-trip completes — same rationale as
    // next-themes' setTheme() below for theme.
    if (patch.density !== undefined && typeof document !== "undefined") {
      if (patch.density) document.documentElement.setAttribute("data-density", patch.density);
      else document.documentElement.removeAttribute("data-density");
    }
    startTransition(async () => {
      // Cast is safe: PreferencesDto uses `string | null` for theme/density
      // (matches the DB), but updateMyPreferences narrows them to the enum
      // set via Zod. The Appearance UI only feeds enum values in.
      await updateMyPreferences(patch as never);
    });
  }

  const currentTheme = prefs?.theme ?? theme ?? "system";
  const currentDensity = prefs?.density ?? "regular";
  const currentLanding = prefs?.defaultLanding ?? LANDING_BY_ROLE[role][0].value;

  return (
    <div className="space-y-6 max-w-xl">
      <div className="bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl p-6 space-y-4">
        <h2 className="text-[15px] font-semibold">Theme</h2>
        <p className="text-[13px] text-[var(--color-neutral-600)]">
          Syncs across every device you sign in on.
        </p>
        <div className="flex gap-2">
          {THEME_OPTIONS.map((opt) => {
            const active = mounted && currentTheme === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                disabled={pending}
                onClick={() => {
                  // Persist server-side BEFORE setTheme so the persistence
                  // isn't racing with next-themes' re-render — see the note
                  // in the M21.5 PR description.
                  apply({ theme: opt.value });
                  setTheme(opt.value);
                }}
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

      <div className="bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl p-6 space-y-4">
        <h2 className="text-[15px] font-semibold">Density</h2>
        <p className="text-[13px] text-[var(--color-neutral-600)]">
          Compact packs more content in per screen — best on larger displays.
        </p>
        <div className="flex gap-2">
          {DENSITY_OPTIONS.map((opt) => {
            const active = mounted && currentDensity === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                disabled={pending}
                onClick={() => apply({ density: opt.value })}
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

      <div className="bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl p-6 space-y-4">
        <h2 className="text-[15px] font-semibold">Default landing page</h2>
        <p className="text-[13px] text-[var(--color-neutral-600)]">
          Where signing in takes you.
        </p>
        <select
          value={currentLanding}
          disabled={pending}
          onChange={(e) => apply({ defaultLanding: e.target.value })}
          className="w-full h-10 px-3 rounded-lg border border-[var(--color-neutral-300)] bg-[var(--color-surface)] text-[13px] text-[var(--foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] cursor-pointer"
        >
          {LANDING_BY_ROLE[role].map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
