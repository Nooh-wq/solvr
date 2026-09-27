"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { beginForcedTotpEnrollment } from "@/actions/mfa";
import { completeForcedEnrollment } from "@/actions/auth";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";

// M6.1.b — forced-enrollment UI. Mirrors TwoFactorCard's enrollment
// layout (QR + backup codes + verify prompt) but authenticated by the
// 15-min mfa-enrollment token instead of a session. On success, the
// server issues the session cookie and we route to the role's landing.

export function EnrollmentForm() {
  const router = useRouter();
  const params = useSearchParams();
  const { toast } = useToast();
  const token = params.get("token");

  const [state, setState] = useState<
    | { kind: "loading" }
    | { kind: "failed"; message: string }
    | {
        kind: "ready";
        qrDataUri: string;
        otpauthUri: string;
        backupCodes: string[];
      }
  >({ kind: "loading" });
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!token) {
      setState({ kind: "failed", message: "This enrollment link is missing its token." });
      return;
    }
    (async () => {
      const r = await beginForcedTotpEnrollment({ enrollmentToken: token });
      if (!r.ok) {
        setState({ kind: "failed", message: r.error });
        return;
      }
      setState({
        kind: "ready",
        qrDataUri: r.qrDataUri,
        otpauthUri: r.otpauthUri,
        backupCodes: r.backupCodes,
      });
    })();
  }, [token]);
  /* eslint-enable react-hooks/set-state-in-effect */

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

  function submit() {
    if (!token) return;
    setError(null);
    startTransition(async () => {
      const r = await completeForcedEnrollment({ enrollmentToken: token, code: code.trim() });
      if ("error" in r && r.error) {
        setError(r.error);
        toast({ title: "Couldn't enable 2FA", description: r.error, variant: "error" });
        return;
      }
      if ("ok" in r && r.ok) {
        toast({ title: "2FA enabled", description: "You're signed in.", variant: "success" });
        router.push(r.redirectTo ?? "/portal");
        router.refresh();
      }
    });
  }

  if (state.kind === "loading") {
    return <p className="text-[13px] text-[var(--color-neutral-500)]">Loading enrollment…</p>;
  }
  if (state.kind === "failed") {
    return (
      <div className="space-y-3">
        <p className="text-[13px] text-red-600">{state.message}</p>
        <Button type="button" variant="secondary" onClick={() => router.push("/auth/login")}>
          Back to sign-in
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <ol className="text-[13px] text-[var(--color-neutral-700)] list-decimal ml-4 space-y-1">
        <li>Scan the QR code with an authenticator app (1Password, Google Authenticator, Authy).</li>
        <li>Save your backup codes — the only way back in if you lose your device.</li>
        <li>Enter the 6-digit code from your app to finish and sign in.</li>
      </ol>
      <div className="flex flex-col md:flex-row gap-5">
        <div className="flex flex-col items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={state.qrDataUri}
            alt="Scan with your authenticator app"
            className="rounded-lg border border-[var(--color-neutral-300)] bg-white p-2"
            width={200}
            height={200}
          />
          <details className="text-[11px] text-[var(--color-neutral-500)]">
            <summary className="cursor-pointer">Can&apos;t scan? Enter code manually</summary>
            <code className="block mt-1 break-all bg-[var(--color-surface-muted)] px-2 py-1 rounded text-[10px]">
              {state.otpauthUri}
            </code>
          </details>
        </div>
        <div className="flex-1 space-y-2">
          <p className="text-[12px] font-semibold uppercase tracking-wide text-[var(--color-neutral-600)]">
            Backup codes
          </p>
          <div className="grid grid-cols-2 gap-1.5 font-mono text-[12px]">
            {state.backupCodes.map((c) => (
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
            onClick={() => downloadBackupCodes(state.backupCodes)}
          >
            Download codes
          </Button>
        </div>
      </div>
      <div className="space-y-1.5 pt-2 border-t border-[var(--color-neutral-200)]">
        <Label htmlFor="enrollCode">6-digit code from app</Label>
        <Input
          id="enrollCode"
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="123456"
        />
      </div>
      {error && <p className="text-[13px] text-red-600">{error}</p>}
      <Button onClick={submit} disabled={pending || code.trim().length < 6} className="w-full">
        {pending ? "Verifying…" : "Verify and sign in"}
      </Button>
    </div>
  );
}
