"use client";

// M21.1 — Security tab. Change-password ships now (extracted from the
// old ProfileForm). Email change, active sessions, and login history all
// have a "reserved" callout — real implementations land in M21.2 / M21.3
// respectively. 2FA slot is intentionally "coming soon" per spec §3
// (real TOTP is M6).

import { useEffect, useState, useTransition } from "react";
import { changeMyPassword } from "@/actions/profile";
import { requestEmailChange } from "@/actions/emailChange";
import {
  listMySessions,
  revokeMySession,
  revokeAllOtherSessions,
  listMyLoginHistory,
  type SessionRow,
  type LoginActivityRow,
} from "@/actions/sessions";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { PASSWORD_RULES_HINT } from "@/lib/validation/password";

export function SecurityTab({ currentEmail }: { currentEmail: string }) {
  const { toast } = useToast();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function save() {
    setError(null);
    startTransition(async () => {
      const result = await changeMyPassword({ currentPassword, newPassword });
      if ("error" in result && result.error) {
        setError(result.error);
        toast({ title: "Couldn't update password", description: result.error, variant: "error" });
        return;
      }
      setCurrentPassword("");
      setNewPassword("");
      toast({
        title: "Password updated",
        description: "Other sessions have been signed out.",
        variant: "success",
      });
    });
  }

  return (
    <div className="space-y-6 max-w-xl">
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
        {error && <p className="text-[13px] text-red-600">{error}</p>}
        <Button onClick={save} disabled={pending || !currentPassword || newPassword.length < 8}>
          {pending ? "Updating…" : "Update password"}
        </Button>
      </div>

      <EmailChangeCard currentEmail={currentEmail} />
      <ActiveSessionsCard />
      <LoginHistoryCard />
      <ReservedCard
        title="Two-factor authentication"
        note="Not enabled — ships with M6 (SSO / SAML / SCIM)."
      />
    </div>
  );
}

// M21.2 — password-gated email change. Requests a confirmation link to
// the new address; a fraud-alert email goes to the current address at the
// same time. On confirm, all sessions are revoked and the user has to
// sign in with the new email.
function EmailChangeCard({ currentEmail }: { currentEmail: string }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [pending, startTransition] = useTransition();

  function submit() {
    setError(null);
    startTransition(async () => {
      const result = await requestEmailChange({ newEmail, currentPassword: password });
      if ("error" in result) {
        setError(result.error);
        toast({ title: "Couldn't request change", description: result.error, variant: "error" });
        return;
      }
      setSent(true);
      setPassword("");
      toast({
        title: "Confirmation email sent",
        description: `Check ${newEmail} for a link to confirm.`,
        variant: "success",
      });
    });
  }

  return (
    <div className="bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl p-6 space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-[15px] font-semibold">Email address</h2>
          <p className="text-[13px] text-[var(--color-neutral-600)] mt-1">{currentEmail}</p>
        </div>
        {!open && (
          <Button type="button" variant="secondary" size="sm" onClick={() => setOpen(true)}>
            Change
          </Button>
        )}
      </div>

      {open && !sent && (
        <div className="space-y-4 pt-2">
          <p className="text-[12px] text-[var(--color-neutral-600)]">
            We&apos;ll send a confirmation link to the new address and a heads-up to your current
            one. Once you confirm, every other signed-in device is signed out.
          </p>
          <div className="space-y-1.5">
            <Label htmlFor="newEmail">New email</Label>
            <Input
              id="newEmail"
              type="email"
              autoComplete="email"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="emailChangePassword">Current password</Label>
            <Input
              id="emailChangePassword"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          {error && <p className="text-[13px] text-red-600">{error}</p>}
          <div className="flex gap-2">
            <Button onClick={submit} disabled={pending || !newEmail || !password}>
              {pending ? "Sending…" : "Send confirmation"}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setOpen(false);
                setError(null);
                setNewEmail("");
                setPassword("");
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      {sent && (
        <p className="text-[13px] rounded-lg border border-green-300/60 dark:border-green-500/30 bg-green-50/60 dark:bg-green-500/5 text-green-800 dark:text-green-300 px-3 py-2">
          Confirmation link sent to <strong>{newEmail}</strong>. It expires in 24 hours.
        </p>
      )}
    </div>
  );
}

// M21.3 — active-sessions list with per-row revoke + revoke-all-others.
// Fetched client-side on mount so the tab lands fast (server round-trip
// only for the specific card, not the whole /account page).
function ActiveSessionsCard() {
  const { toast } = useToast();
  const [sessions, setSessions] = useState<SessionRow[] | null>(null);
  const [pending, startTransition] = useTransition();

  async function refresh() {
    const rows = await listMySessions();
    setSessions(rows);
  }
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    refresh();
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  function revokeOne(id: string) {
    startTransition(async () => {
      const r = await revokeMySession(id);
      if ("error" in r) {
        toast({ title: "Couldn't revoke", description: r.error, variant: "error" });
        return;
      }
      toast({ title: "Session revoked", variant: "success" });
      await refresh();
    });
  }

  function revokeAll() {
    startTransition(async () => {
      const r = await revokeAllOtherSessions();
      toast({
        title: r.revoked > 0 ? `Signed out ${r.revoked} other session${r.revoked === 1 ? "" : "s"}` : "No other sessions were active",
        variant: "success",
      });
      await refresh();
    });
  }

  return (
    <div className="bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-[15px] font-semibold">Active sessions</h2>
        {sessions && sessions.length > 1 && (
          <Button type="button" variant="secondary" size="sm" disabled={pending} onClick={revokeAll}>
            Sign out others
          </Button>
        )}
      </div>
      {sessions === null ? (
        <p className="text-[13px] text-[var(--color-neutral-500)]">Loading…</p>
      ) : sessions.length === 0 ? (
        <p className="text-[13px] text-[var(--color-neutral-500)]">No active sessions.</p>
      ) : (
        <ul className="divide-y divide-[var(--color-neutral-200)] dark:divide-white/10 -mx-2">
          {sessions.map((s) => (
            <li key={s.id} className="px-2 py-3 flex items-center gap-4">
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-medium flex items-center gap-2">
                  <span>
                    {s.device}
                    {s.browser ? ` · ${s.browser}` : ""}
                  </span>
                  {s.isCurrent && (
                    <span className="text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded-md bg-[var(--color-primary)]/10 text-[var(--color-primary)]">
                      This device
                    </span>
                  )}
                </div>
                <div className="text-[11px] text-[var(--color-neutral-500)] mt-0.5">
                  {s.ipAddress ?? "unknown IP"} · Last active {formatRelative(s.lastActiveAt)}
                </div>
              </div>
              {!s.isCurrent && (
                <Button type="button" variant="secondary" size="sm" disabled={pending} onClick={() => revokeOne(s.id)}>
                  Revoke
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// M21.3 — last 20 login rows for this subject.
function LoginHistoryCard() {
  const [rows, setRows] = useState<LoginActivityRow[] | null>(null);
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    (async () => {
      setRows(await listMyLoginHistory());
    })();
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  return (
    <div className="bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl p-6 space-y-4">
      <h2 className="text-[15px] font-semibold">Login history</h2>
      {rows === null ? (
        <p className="text-[13px] text-[var(--color-neutral-500)]">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-[13px] text-[var(--color-neutral-500)]">No recent logins recorded.</p>
      ) : (
        <ul className="divide-y divide-[var(--color-neutral-200)] dark:divide-white/10 -mx-2">
          {rows.map((r) => (
            <li key={r.id} className="px-2 py-2.5">
              <div className="text-[13px] font-medium">
                {r.device}
                {r.browser ? ` · ${r.browser}` : ""}
              </div>
              <div className="text-[11px] text-[var(--color-neutral-500)] mt-0.5">
                {r.ipAddress ?? "unknown IP"}
                {r.country ? ` · ${r.country}` : ""} · {formatAbsolute(r.createdAt)}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function formatRelative(d: Date | string): string {
  const date = typeof d === "string" ? new Date(d) : d;
  const diffMs = Date.now() - date.getTime();
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return date.toLocaleDateString();
}

function formatAbsolute(d: Date | string): string {
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function ReservedCard({ title, note }: { title: string; note: string }) {
  return (
    <div className="bg-[var(--color-surface)] border border-dashed border-[var(--color-neutral-300)] rounded-2xl p-6 space-y-2">
      <div className="flex items-center justify-between">
        <h2 className="text-[15px] font-semibold">{title}</h2>
        <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-neutral-500)]">
          Coming soon
        </span>
      </div>
      <p className="text-[13px] text-[var(--color-neutral-600)]">{note}</p>
    </div>
  );
}
