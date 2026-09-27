"use client";

// M21.1 — Security tab. Change-password ships now (extracted from the
// old ProfileForm). Email change, active sessions, login history land in
// M21.2 / M21.3. 2FA (TOTP) is M6.1, replacing the earlier "coming soon"
// slot.

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
import {
  beginTotpEnrollment,
  confirmTotpEnrollment,
  disableTotp,
  getMyMfaState,
} from "@/actions/mfa";
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
      <TwoFactorCard />
    </div>
  );
}

// M6.1 — TOTP 2FA card. Enrollment shows the QR + backup codes exactly
// once; the codes are the recovery path if the user loses their device.
// Disable flow requires BOTH the current password AND a valid code.
function TwoFactorCard() {
  const { toast } = useToast();
  const [state, setState] = useState<
    | { loading: true }
    | { loading: false; enabled: boolean; enabledAt: Date | null; backupCodesRemaining: number }
  >({ loading: true });
  const [pending, startTransition] = useTransition();
  const [enrollment, setEnrollment] = useState<{
    qrDataUri: string;
    otpauthUri: string;
    backupCodes: string[];
  } | null>(null);
  const [confirmCode, setConfirmCode] = useState("");
  const [enrollError, setEnrollError] = useState<string | null>(null);
  const [disableOpen, setDisableOpen] = useState(false);
  const [disablePassword, setDisablePassword] = useState("");
  const [disableCode, setDisableCode] = useState("");
  const [disableError, setDisableError] = useState<string | null>(null);

  async function refresh() {
    const s = await getMyMfaState();
    setState({ loading: false, ...s });
  }

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    refresh();
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  function startEnrollment() {
    setEnrollError(null);
    startTransition(async () => {
      const r = await beginTotpEnrollment();
      if (!r.ok) {
        toast({ title: "Couldn't start enrollment", description: r.error, variant: "error" });
        return;
      }
      setEnrollment({
        qrDataUri: r.qrDataUri,
        otpauthUri: r.otpauthUri,
        backupCodes: r.backupCodes,
      });
    });
  }

  function confirmEnrollment() {
    setEnrollError(null);
    startTransition(async () => {
      const r = await confirmTotpEnrollment({ code: confirmCode.trim() });
      if (!r.ok) {
        setEnrollError(r.error);
        toast({ title: "Couldn't enable 2FA", description: r.error, variant: "error" });
        // Server wipes the pending secret on wrong code — close the
        // enrollment view so the user hits the fresh-start path next
        // time they open it.
        setEnrollment(null);
        setConfirmCode("");
        await refresh();
        return;
      }
      setEnrollment(null);
      setConfirmCode("");
      toast({
        title: "2FA enabled",
        description: "You'll be asked for a code on your next sign-in.",
        variant: "success",
      });
      await refresh();
    });
  }

  function submitDisable() {
    setDisableError(null);
    startTransition(async () => {
      const r = await disableTotp({ currentPassword: disablePassword, code: disableCode.trim() });
      if (!r.ok) {
        setDisableError(r.error);
        toast({ title: "Couldn't disable 2FA", description: r.error, variant: "error" });
        return;
      }
      setDisableOpen(false);
      setDisablePassword("");
      setDisableCode("");
      toast({ title: "2FA disabled", variant: "success" });
      await refresh();
    });
  }

  function downloadBackupCodes(codes: string[]) {
    const blob = new Blob(
      [
        `Stralis Support — 2FA backup codes\n` +
          `Generated: ${new Date().toLocaleString()}\n\n` +
          `Each code works once. Keep them somewhere safe — if you lose your\n` +
          `authenticator app, these are the only way back into your account.\n\n` +
          codes.join("\n") +
          "\n",
      ],
      { type: "text/plain" }
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "stralis-2fa-backup-codes.txt";
    a.click();
    URL.revokeObjectURL(url);
  }

  if (state.loading) {
    return (
      <div className="bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl p-6 space-y-2">
        <h2 className="text-[15px] font-semibold">Two-factor authentication</h2>
        <p className="text-[13px] text-[var(--color-neutral-500)]">Loading…</p>
      </div>
    );
  }

  // Enrollment in progress: show QR + backup codes + verify prompt.
  if (enrollment) {
    return (
      <div className="bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl p-6 space-y-4">
        <h2 className="text-[15px] font-semibold">Set up two-factor authentication</h2>
        <ol className="text-[13px] text-[var(--color-neutral-700)] list-decimal ml-4 space-y-1">
          <li>Scan the QR code with an authenticator app (1Password, Google Authenticator, Authy).</li>
          <li>Save your backup codes somewhere safe — they&apos;re the only way back in if you lose your device.</li>
          <li>Enter the 6-digit code from the app to finish setup.</li>
        </ol>
        <div className="flex flex-col md:flex-row gap-6">
          <div className="flex flex-col items-center gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={enrollment.qrDataUri}
              alt="Scan with your authenticator app"
              className="rounded-lg border border-[var(--color-neutral-300)] bg-white p-2"
              width={200}
              height={200}
            />
            <details className="text-[11px] text-[var(--color-neutral-500)]">
              <summary className="cursor-pointer">Can&apos;t scan? Enter code manually</summary>
              <code className="block mt-1 break-all bg-[var(--color-surface-muted)] px-2 py-1 rounded text-[10px]">
                {enrollment.otpauthUri}
              </code>
            </details>
          </div>
          <div className="flex-1 space-y-2">
            <p className="text-[12px] font-semibold uppercase tracking-wide text-[var(--color-neutral-600)]">
              Backup codes
            </p>
            <div className="grid grid-cols-2 gap-1.5 font-mono text-[12px]">
              {enrollment.backupCodes.map((c) => (
                <div
                  key={c}
                  className="bg-[var(--color-surface-muted)] px-2 py-1 rounded border border-[var(--color-neutral-200)]"
                >
                  {c}
                </div>
              ))}
            </div>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => downloadBackupCodes(enrollment.backupCodes)}
            >
              Download codes
            </Button>
          </div>
        </div>
        <div className="space-y-1.5 pt-2 border-t border-[var(--color-neutral-200)]">
          <Label htmlFor="confirmCode">6-digit code from app</Label>
          <Input
            id="confirmCode"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            value={confirmCode}
            onChange={(e) => setConfirmCode(e.target.value)}
            placeholder="123456"
          />
        </div>
        {enrollError && <p className="text-[13px] text-red-600">{enrollError}</p>}
        <div className="flex gap-2">
          <Button onClick={confirmEnrollment} disabled={pending || confirmCode.trim().length < 6}>
            {pending ? "Verifying…" : "Verify and enable"}
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              setEnrollment(null);
              setConfirmCode("");
              setEnrollError(null);
            }}
          >
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  // Enabled state.
  if (state.enabled) {
    return (
      <div className="bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl p-6 space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-[15px] font-semibold flex items-center gap-2">
              Two-factor authentication
              <span className="text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded-md bg-green-500/10 text-green-700 dark:text-green-400">
                Enabled
              </span>
            </h2>
            <p className="text-[13px] text-[var(--color-neutral-600)] mt-1">
              Enabled {state.enabledAt ? formatAbsolute(state.enabledAt) : ""} · {state.backupCodesRemaining} backup code{state.backupCodesRemaining === 1 ? "" : "s"} remaining
            </p>
          </div>
          {!disableOpen && (
            <Button type="button" variant="secondary" size="sm" onClick={() => setDisableOpen(true)}>
              Disable
            </Button>
          )}
        </div>
        {disableOpen && (
          <div className="space-y-3 pt-2 border-t border-[var(--color-neutral-200)]">
            <p className="text-[12px] text-[var(--color-neutral-600)]">
              Disabling 2FA requires both your current password and a valid code from your app.
            </p>
            <div className="space-y-1.5">
              <Label htmlFor="disablePassword">Current password</Label>
              <Input
                id="disablePassword"
                type="password"
                autoComplete="current-password"
                value={disablePassword}
                onChange={(e) => setDisablePassword(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="disableCode">6-digit code</Label>
              <Input
                id="disableCode"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                value={disableCode}
                onChange={(e) => setDisableCode(e.target.value)}
                placeholder="123456"
              />
            </div>
            {disableError && <p className="text-[13px] text-red-600">{disableError}</p>}
            <div className="flex gap-2">
              <Button onClick={submitDisable} disabled={pending || !disablePassword || disableCode.trim().length < 6}>
                {pending ? "Disabling…" : "Disable 2FA"}
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setDisableOpen(false);
                  setDisablePassword("");
                  setDisableCode("");
                  setDisableError(null);
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}
      </div>
    );
  }

  // Disabled state.
  return (
    <div className="bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl p-6 space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-[15px] font-semibold">Two-factor authentication</h2>
          <p className="text-[13px] text-[var(--color-neutral-600)] mt-1">
            Add a second step to your sign-in for extra security.
          </p>
        </div>
        <Button type="button" variant="secondary" size="sm" disabled={pending} onClick={startEnrollment}>
          {pending ? "Starting…" : "Enable 2FA"}
        </Button>
      </div>
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

