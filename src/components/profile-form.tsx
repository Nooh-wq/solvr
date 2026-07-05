"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useTheme } from "next-themes";
import { updateProfile, changeMyPassword, uploadProfilePicture } from "@/actions/profile";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { PASSWORD_RULES_HINT } from "@/lib/validation/password";
import type { Role } from "@/generated/prisma";

const ROLE_LABEL: Record<Role, string> = {
  CLIENT: "Client",
  AGENT: "Agent",
  ADMIN: "Admin",
  SUPER_ADMIN: "Super Admin",
};

const THEME_OPTIONS: { value: "light" | "dark" | "system"; label: string }[] = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System" },
];

type Profile = { name: string; email: string; company: string | null; role: Role; avatarUrl: string | null };

function initialsOf(name: string) {
  return name
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export function ProfileForm({ profile }: { profile: Profile }) {
  const { toast } = useToast();
  const { theme, setTheme } = useTheme();
  // next-themes doesn't know the persisted theme until after mount (it reads
  // localStorage client-side) — rendering the active option before then would
  // hydrate-mismatch against the server's guess, so nothing is marked active
  // until `mounted` flips.
  const [mounted, setMounted] = useState(false);
  /* eslint-disable react-hooks/set-state-in-effect -- genuinely one-time: flips once after client mount, same pattern as sidebar.tsx's own mounted flag */
  useEffect(() => setMounted(true), []);
  /* eslint-enable react-hooks/set-state-in-effect */
  const [name, setName] = useState(profile.name);
  const [company, setCompany] = useState(profile.company ?? "");
  const [profileSaved, setProfileSaved] = useState(false);
  const [profilePending, startProfileTransition] = useTransition();

  const [avatarUrl, setAvatarUrl] = useState(profile.avatarUrl);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const [avatarUploading, startAvatarTransition] = useTransition();
  const avatarInputRef = useRef<HTMLInputElement>(null);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordSaved, setPasswordSaved] = useState(false);
  const [passwordPending, startPasswordTransition] = useTransition();

  function onAvatarSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setAvatarError(null);
    const formData = new FormData();
    formData.set("file", file);
    startAvatarTransition(async () => {
      const result = await uploadProfilePicture(formData);
      if (!result.ok) {
        setAvatarError(result.error);
        toast({ title: "Couldn't upload photo", description: result.error, variant: "error" });
        return;
      }
      setAvatarUrl(result.url);
      toast({ title: "Profile photo updated", variant: "success" });
    });
    e.target.value = "";
  }

  function saveProfile() {
    setProfileSaved(false);
    startProfileTransition(async () => {
      await updateProfile({ name, company: company || undefined });
      setProfileSaved(true);
      toast({ title: "Profile saved", variant: "success" });
    });
  }

  function savePassword() {
    setPasswordError(null);
    setPasswordSaved(false);
    startPasswordTransition(async () => {
      const result = await changeMyPassword({ currentPassword, newPassword });
      if ("error" in result && result.error) {
        setPasswordError(result.error);
        toast({ title: "Couldn't update password", description: result.error, variant: "error" });
        return;
      }
      setCurrentPassword("");
      setNewPassword("");
      setPasswordSaved(true);
      toast({ title: "Password updated", description: "Other sessions have been signed out.", variant: "success" });
    });
  }

  return (
    <div className="space-y-8 max-w-md">
      <div className="bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl p-6 space-y-4">
        <h2 className="text-[15px] font-semibold">Appearance</h2>
        <p className="text-[13px] text-[var(--color-neutral-600)]">Choose how solvr looks on this device.</p>
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

      <div className="bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl p-6 space-y-4">
        <h2 className="text-[15px] font-semibold">Your details</h2>
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
            {avatarError && <p className="text-[12px] text-red-600 mt-1">{avatarError}</p>}
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="email">Email</Label>
          <Input id="email" value={profile.email} disabled />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="role">Role</Label>
          <Input id="role" value={ROLE_LABEL[profile.role]} disabled />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="name">Full name</Label>
          <Input id="name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="company">Company</Label>
          <Input id="company" value={company} onChange={(e) => setCompany(e.target.value)} />
        </div>
        {profileSaved && <p className="text-[13px] text-green-700">Saved.</p>}
        <Button onClick={saveProfile} disabled={profilePending || !name.trim()}>
          {profilePending ? "Saving…" : "Save changes"}
        </Button>
      </div>

      <div className="bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl p-6 space-y-4">
        <h2 className="text-[15px] font-semibold">Change password</h2>
        <div className="space-y-1.5">
          <Label htmlFor="currentPassword">Current password</Label>
          <Input
            id="currentPassword"
            type="password"
            autoComplete="current-password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="newPassword">New password</Label>
          <Input
            id="newPassword"
            type="password"
            autoComplete="new-password"
            minLength={8}
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
          />
          <p className="text-[11px] text-[var(--color-neutral-500)]">{PASSWORD_RULES_HINT}</p>
        </div>
        {passwordError && <p className="text-[13px] text-red-600">{passwordError}</p>}
        {passwordSaved && <p className="text-[13px] text-green-700">Password updated.</p>}
        <Button
          onClick={savePassword}
          disabled={passwordPending || !currentPassword || newPassword.length < 8}
        >
          {passwordPending ? "Updating…" : "Update password"}
        </Button>
      </div>
    </div>
  );
}
