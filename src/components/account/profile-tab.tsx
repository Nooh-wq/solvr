"use client";

// M21.1 — Profile tab. Editable: name, timezone, language, avatar.
// Read-only: email (see M21.2 for the password-gated flow), role,
// company (both admin-only per spec §3).

import { useRef, useState, useTransition } from "react";
import { updateProfile, uploadProfilePicture } from "@/actions/profile";
import { updateMyPreferences, type PreferencesDto } from "@/actions/preferences";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import type { UserRole as Role } from "@/lib/auth";

const ROLE_LABEL: Record<Role, string> = {
  CLIENT: "Client",
  AGENT: "Agent",
  ADMIN: "Admin",
  SUPER_ADMIN: "Super Admin",
};

// Small curated list — good enough for M21.1. A full IANA picker is more
// UI weight than the milestone budget. "System default" leaves the value
// null and the browser's inferred zone applies.
const TIMEZONES = [
  { value: "", label: "System default" },
  { value: "UTC", label: "UTC" },
  { value: "America/New_York", label: "US / Eastern" },
  { value: "America/Chicago", label: "US / Central" },
  { value: "America/Denver", label: "US / Mountain" },
  { value: "America/Los_Angeles", label: "US / Pacific" },
  { value: "Europe/London", label: "London" },
  { value: "Europe/Berlin", label: "Berlin" },
  { value: "Europe/Paris", label: "Paris" },
  { value: "Asia/Dubai", label: "Dubai" },
  { value: "Asia/Karachi", label: "Karachi" },
  { value: "Asia/Kolkata", label: "Kolkata" },
  { value: "Asia/Singapore", label: "Singapore" },
  { value: "Asia/Tokyo", label: "Tokyo" },
  { value: "Australia/Sydney", label: "Sydney" },
];

const LANGUAGES = [
  { value: "", label: "System default" },
  { value: "en", label: "English" },
  { value: "es", label: "Español" },
  { value: "fr", label: "Français" },
  { value: "de", label: "Deutsch" },
  { value: "ar", label: "العربية" },
];

export type ProfileTabData = {
  name: string;
  email: string;
  company: string | null;
  role: Role;
  avatarUrl: string | null;
};

function initialsOf(name: string) {
  return name
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export function ProfileTab({
  profile,
  preferences,
}: {
  profile: ProfileTabData;
  preferences: PreferencesDto;
}) {
  const { toast } = useToast();
  const [name, setName] = useState(profile.name);
  const [timezone, setTimezone] = useState(preferences.timezone ?? "");
  const [language, setLanguage] = useState(preferences.language ?? "");
  const [pending, startTransition] = useTransition();

  const [avatarUrl, setAvatarUrl] = useState(profile.avatarUrl);
  const [avatarUploading, startAvatarTransition] = useTransition();
  const avatarInputRef = useRef<HTMLInputElement>(null);

  function onAvatarSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const formData = new FormData();
    formData.set("file", file);
    startAvatarTransition(async () => {
      const result = await uploadProfilePicture(formData);
      if (!result.ok) {
        toast({ title: "Couldn't upload photo", description: result.error, variant: "error" });
        return;
      }
      setAvatarUrl(result.url);
      toast({ title: "Profile photo updated", variant: "success" });
    });
    e.target.value = "";
  }

  function save() {
    startTransition(async () => {
      // Two writes on save so name (wrapper) and prefs (Support) each go to
      // their owner. Sequential rather than Promise.all — prefs is small,
      // and if wrapper fails there's nothing to roll back.
      await updateProfile({ name });
      await updateMyPreferences({
        timezone: timezone || null,
        language: language || null,
      });
      toast({ title: "Profile saved", variant: "success" });
    });
  }

  return (
    <div className="space-y-6 max-w-xl">
      <div className="bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl p-6 space-y-4">
        <h2 className="text-[15px] font-semibold">Photo</h2>
        <div className="flex items-center gap-4">
          {avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={avatarUrl} alt="" className="h-16 w-16 rounded-full object-cover" />
          ) : (
            <span className="h-16 w-16 rounded-full bg-[var(--color-neutral-300)] text-[18px] font-semibold text-[var(--foreground)] flex items-center justify-center">
              {initialsOf(name)}
            </span>
          )}
          <div>
            <input
              ref={avatarInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={onAvatarSelected}
            />
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={avatarUploading}
              onClick={() => avatarInputRef.current?.click()}
            >
              {avatarUploading ? "Uploading…" : "Change photo"}
            </Button>
            <p className="text-[11px] text-[var(--color-neutral-500)] mt-1">PNG, JPEG, or WEBP — up to 2MB.</p>
          </div>
        </div>
      </div>

      <div className="bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl p-6 space-y-4">
        <h2 className="text-[15px] font-semibold">Your details</h2>
        <div className="space-y-1.5">
          <Label htmlFor="name">Full name</Label>
          <Input id="name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="email">Email</Label>
          <Input id="email" value={profile.email} disabled />
          <p className="text-[11px] text-[var(--color-neutral-500)]">
            Change your email from the Security tab.
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="role">Role</Label>
          <Input id="role" value={ROLE_LABEL[profile.role]} disabled />
          <p className="text-[11px] text-[var(--color-neutral-500)]">Role changes are managed by an admin.</p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="company">Company</Label>
          <Input id="company" value={profile.company ?? ""} disabled placeholder="—" />
          <p className="text-[11px] text-[var(--color-neutral-500)]">
            Company membership is managed by an admin.
          </p>
        </div>
      </div>

      <div className="bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl p-6 space-y-4">
        <h2 className="text-[15px] font-semibold">Locale</h2>
        <div className="space-y-1.5">
          <Label htmlFor="timezone">Timezone</Label>
          <select
            id="timezone"
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
            className="w-full h-10 px-3 rounded-lg border border-[var(--color-neutral-300)] bg-[var(--color-surface)] text-[13px] text-[var(--foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] cursor-pointer"
          >
            {TIMEZONES.map((tz) => (
              <option key={tz.value} value={tz.value}>
                {tz.label}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="language">Language</Label>
          <select
            id="language"
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            className="w-full h-10 px-3 rounded-lg border border-[var(--color-neutral-300)] bg-[var(--color-surface)] text-[13px] text-[var(--foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] cursor-pointer"
          >
            {LANGUAGES.map((l) => (
              <option key={l.value} value={l.value}>
                {l.label}
              </option>
            ))}
          </select>
          <p className="text-[11px] text-[var(--color-neutral-500)]">
            Translations ship in a later milestone; your preference is saved now.
          </p>
        </div>
      </div>

      <Button onClick={save} disabled={pending || !name.trim()}>
        {pending ? "Saving…" : "Save changes"}
      </Button>
    </div>
  );
}
