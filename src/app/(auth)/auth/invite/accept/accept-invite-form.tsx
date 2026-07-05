"use client";

import { useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { acceptInvite, verifyLoginOtp } from "@/actions/auth";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { PASSWORD_RULES_HINT } from "@/lib/validation/password";

export function AcceptInviteForm() {
  const router = useRouter();
  const params = useSearchParams();
  const { toast } = useToast();
  const token = params.get("token") ?? "";

  const [otpToken, setOtpToken] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!token) {
    return (
      <p className="text-sm text-[var(--color-neutral-600)]">
        This invite link is missing its token. Ask whoever invited you to send a new one, or{" "}
        <Link href="/auth/login" className="text-[var(--color-primary)] font-medium">
          log in
        </Link>{" "}
        if you already have an account.
      </p>
    );
  }

  function submitPassword() {
    setError(null);
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords don't match.");
      return;
    }
    startTransition(async () => {
      const result = await acceptInvite({ token, password });
      if ("error" in result) {
        setError(result.error);
        toast({ title: "Couldn't accept invite", description: result.error, variant: "error" });
        return;
      }
      setOtpToken(result.otpToken);
      toast({ title: "Check your email", description: "We sent you a one-time verification code.", variant: "info" });
    });
  }

  function submitCode() {
    if (!otpToken) return;
    setError(null);
    startTransition(async () => {
      const result = await verifyLoginOtp({ otpToken, code });
      if ("error" in result) {
        setError(result.error);
        toast({ title: "Couldn't verify code", description: result.error, variant: "error" });
        return;
      }
      toast({ title: "You're all set", variant: "success" });
      router.push(result.redirectTo);
      router.refresh();
    });
  }

  if (otpToken) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-[var(--color-neutral-600)]">Enter the 6-digit code we just emailed you.</p>
        <div className="space-y-1.5">
          <Label htmlFor="code">Verification code</Label>
          <Input
            id="code"
            inputMode="numeric"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            placeholder="000000"
            className="text-center text-lg tracking-[0.4em] font-mono"
            autoFocus
          />
        </div>
        {error && <p className="text-[13px] text-red-600">{error}</p>}
        <Button className="w-full" onClick={submitCode} disabled={pending || code.length !== 6}>
          {pending ? "Verifying…" : "Verify & continue"}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="password">Choose a password</Label>
        <Input
          id="password"
          type="password"
          autoComplete="new-password"
          minLength={8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <p className="text-[11px] text-[var(--color-neutral-500)]">{PASSWORD_RULES_HINT}</p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="confirmPassword">Confirm password</Label>
        <Input
          id="confirmPassword"
          type="password"
          autoComplete="new-password"
          minLength={8}
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submitPassword()}
        />
      </div>
      {error && <p className="text-[13px] text-red-600">{error}</p>}
      <Button className="w-full" onClick={submitPassword} disabled={pending || !password || !confirmPassword}>
        {pending ? "Setting up…" : "Continue"}
      </Button>
    </div>
  );
}
