"use client";

// M21.1 — Account Settings shell. Client-side tab switcher (no URL
// segment: adding five sub-routes for a settings page is overkill —
// deep-linking can come later via ?tab= if the need shows up). All five
// tabs are always mounted-on-demand from a single server-fetched props
// bundle so the initial load stays one round-trip.

import { useState } from "react";
import type { UserRole as Role } from "@/lib/auth";
import type { PreferencesDto } from "@/actions/preferences";
import { ProfileTab, type ProfileTabData } from "./profile-tab";
import { SecurityTab } from "./security-tab";
import { NotificationsTab } from "./notifications-tab";
import { AppearanceTab } from "./appearance-tab";
import { DangerZoneTab } from "./danger-zone-tab";

type TabKey = "profile" | "security" | "notifications" | "appearance" | "danger";

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: "profile", label: "Profile" },
  { key: "security", label: "Security" },
  { key: "notifications", label: "Notifications" },
  { key: "appearance", label: "Appearance" },
  { key: "danger", label: "Danger Zone" },
];

export function AccountSettingsShell({
  profile,
  preferences,
}: {
  profile: ProfileTabData & { role: Role };
  preferences: PreferencesDto;
}) {
  const [active, setActive] = useState<TabKey>("profile");

  return (
    <div className="max-w-4xl">
      <h1 className="text-2xl font-bold mb-6">Account Settings</h1>

      <div className="flex gap-1 mb-6 border-b border-[var(--color-neutral-300)] overflow-x-auto">
        {TABS.map((t) => {
          const isActive = active === t.key;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setActive(t.key)}
              className={`relative px-4 h-10 text-[13px] font-medium whitespace-nowrap transition-colors duration-150 cursor-pointer ${
                isActive
                  ? "text-[var(--foreground)]"
                  : "text-[var(--color-neutral-600)] hover:text-[var(--foreground)]"
              }`}
              aria-current={isActive ? "page" : undefined}
            >
              {t.label}
              {isActive && (
                <span className="absolute left-2 right-2 -bottom-px h-0.5 bg-[var(--color-primary)] rounded-full" />
              )}
            </button>
          );
        })}
      </div>

      {active === "profile" && <ProfileTab profile={profile} preferences={preferences} />}
      {active === "security" && <SecurityTab currentEmail={profile.email} />}
      {active === "notifications" && <NotificationsTab />}
      {active === "appearance" && <AppearanceTab role={profile.role} />}
      {active === "danger" && <DangerZoneTab />}
    </div>
  );
}
