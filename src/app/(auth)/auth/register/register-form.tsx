"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { registerClient, verifyRegistrationOtp } from "@/actions/auth";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { PASSWORD_RULES_HINT } from "@/lib/validation/password";

export function RegisterForm() {
  const router = useRouter();
  const { toast } = useToast();
  const [error, setError] = useState<string | null>(null);
  const [otpToken, setOtpToken] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [done, setDone] = useState<{ pending: boolean } | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const result = await registerClient({
        name: String(formData.get("name")),
        email: String(formData.get("email")),
        password: String(formData.get("password")),
        company: String(formData.get("company") || "") || undefined,
      });
      if ("error" in result) {
        setError(result.error);
        toast({ title: "Couldn't create account", description: result.error, variant: "error" });
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
      const result = await verifyRegistrationOtp({ otpToken, code });
      if ("error" in result) {
        setError(result.error);
        toast({ title: "Couldn't verify code", description: result.error, variant: "error" });
        return;
      }
      if ("redirectTo" in result) {
        toast({ title: "You're all set", variant: "success" });
        router.push(result.redirectTo);
        router.refresh();
        return;
      }
      setDone({ pending: true });
    });
  }

  if (done) {
    return (
      <div className="space-y-4">
        <p className="text-[14px] text-[var(--color-neutral-800)]">
          Email verified. An admin needs to approve your account before you can log in — we&apos;ll email you when that happens.
        </p>
        <Button className="w-full" onClick={() => router.push("/auth/login")}>
          Go to login
        </Button>
      </div>
    );
  }

  if (otpToken) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-[var(--color-neutral-600)]">Enter the 6-digit code we just emailed you to confirm it&apos;s really you.</p>
        <div className="space-y-1.5">
          <Label htmlFor="code">Verification code</Label>
          <Input
            id="code"
            inputMode="numeric"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            onKeyDown={(e) => e.key === "Enter" && submitCode()}
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
    <form action={onSubmit} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="name">Full name</Label>
        <Input id="name" name="name" required autoComplete="name" />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="company">Company</Label>
        <Input id="company" name="company" autoComplete="organization" />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" required autoComplete="email" />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="password">Password</Label>
        <Input id="password" name="password" type="password" required minLength={8} autoComplete="new-password" />
        <p className="text-[11px] text-[var(--color-neutral-500)]">{PASSWORD_RULES_HINT}</p>
      </div>
      {error && <p className="text-[13px] text-red-600">{error}</p>}
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Creating account…" : "Create account"}
      </Button>
    </form>
  );
}
