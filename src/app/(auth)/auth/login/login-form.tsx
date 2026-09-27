"use client";

import { useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { login, completeMfaLogin } from "@/actions/auth";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const { toast } = useToast();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  // M6.1 — when the password step returns { requiresMfa }, we hold the
  // challenge token here and swap the form to a code-entry state instead
  // of navigating. The token expires in 5 min; the user restarts from
  // the top if it lapses.
  const [challengeToken, setChallengeToken] = useState<string | null>(null);
  const [mfaCode, setMfaCode] = useState("");

  function onPasswordSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const result = await login({
        email: String(formData.get("email")),
        password: String(formData.get("password")),
      });
      if ("error" in result && result.error) {
        setError(result.error);
        toast({ title: "Couldn't log in", description: result.error, variant: "error" });
        return;
      }
      if ("requiresMfa" in result && result.requiresMfa) {
        setChallengeToken(result.challengeToken);
        return;
      }
      // M6.1.b — tenant-wide MFA enforcement. User has valid password
      // but has never enrolled and the tenant now requires it. Send them
      // through forced enrollment; on success they land signed in.
      if ("requiresEnrollment" in result && result.requiresEnrollment) {
        router.push(`/auth/enroll-2fa?token=${encodeURIComponent(result.enrollmentToken)}`);
        return;
      }
      if ("ok" in result && result.ok) {
        router.push(params.get("next") ?? result.redirectTo ?? "/portal");
        router.refresh();
      }
    });
  }

  function onMfaSubmit(formData: FormData) {
    setError(null);
    if (!challengeToken) return;
    startTransition(async () => {
      const result = await completeMfaLogin({
        challengeToken,
        code: String(formData.get("code")).trim(),
      });
      if ("error" in result && result.error) {
        setError(result.error);
        toast({ title: "Couldn't verify code", description: result.error, variant: "error" });
        return;
      }
      if ("ok" in result && result.ok) {
        router.push(params.get("next") ?? result.redirectTo ?? "/portal");
        router.refresh();
      }
    });
  }

  const emailChanged = params.get("emailChanged") === "1";

  if (challengeToken) {
    return (
      <form action={onMfaSubmit} className="space-y-4">
        <div className="rounded-lg border border-[var(--color-neutral-300)] bg-[var(--color-surface-muted)] px-3 py-2">
          <p className="text-[13px] font-medium">Two-factor authentication</p>
          <p className="text-[12px] text-[var(--color-neutral-600)] mt-0.5">
            Enter the 6-digit code from your authenticator app, or one of your backup codes.
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="code">Code</Label>
          <Input
            id="code"
            name="code"
            type="text"
            required
            autoComplete="one-time-code"
            inputMode="text"
            autoFocus
            value={mfaCode}
            onChange={(e) => setMfaCode(e.target.value)}
            placeholder="123456 or xxxxx-xxxxx"
          />
        </div>
        {error && <p className="text-[13px] text-red-600">{error}</p>}
        <Button type="submit" className="w-full" disabled={pending || mfaCode.trim().length < 6}>
          {pending ? "Verifying…" : "Verify and sign in"}
        </Button>
        <button
          type="button"
          className="w-full text-[12px] text-[var(--color-neutral-600)] hover:text-[var(--color-neutral-900)] transition-colors"
          onClick={() => {
            setChallengeToken(null);
            setMfaCode("");
            setError(null);
          }}
        >
          ← Back to sign-in
        </button>
      </form>
    );
  }

  return (
    <form action={onPasswordSubmit} className="space-y-4">
      {emailChanged && (
        <p className="text-[13px] rounded-lg border border-green-300/60 dark:border-green-500/30 bg-green-50/60 dark:bg-green-500/5 text-green-800 dark:text-green-300 px-3 py-2">
          Email address updated. Sign in with your new email.
        </p>
      )}
      <div className="space-y-1.5">
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" required autoComplete="email" />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="password">Password</Label>
        <Input id="password" name="password" type="password" required autoComplete="current-password" />
      </div>
      {error && <p className="text-[13px] text-red-600">{error}</p>}
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Logging in…" : "Log in"}
      </Button>
    </form>
  );
}
