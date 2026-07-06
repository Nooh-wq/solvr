"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { startTenantSignup, verifyTenantSignup } from "@/actions/signup";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { PASSWORD_RULES_HINT } from "@/lib/validation/password";
import { suggestSlugFromName } from "@/lib/validation/signup";

export function SignupForm() {
  const router = useRouter();
  const { toast } = useToast();
  const [tenantName, setTenantName] = useState("");
  // Custom slug the user typed. `null` means "not touched" — the field
  // displays a value derived from tenantName instead, so the slug tracks
  // the company name until the user edits it explicitly.
  const [customSlug, setCustomSlug] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [otpToken, setOtpToken] = useState<string | null>(null);
  const [sentToEmail, setSentToEmail] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [pending, startTransition] = useTransition();

  const slug = customSlug ?? suggestSlugFromName(tenantName);

  function onSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const result = await startTenantSignup({
        tenantName: String(formData.get("tenantName")),
        slug: String(formData.get("slug")),
        adminName: String(formData.get("adminName")),
        adminEmail: String(formData.get("adminEmail")),
        password: String(formData.get("password")),
      });
      if (!result.ok) {
        setError(result.error);
        toast({ title: "Couldn't start signup", description: result.error, variant: "error" });
        return;
      }
      setOtpToken(result.otpToken);
      setSentToEmail(result.email);
      toast({ title: "Check your email", description: "We sent a 6-digit code.", variant: "info" });
    });
  }

  function submitCode() {
    if (!otpToken) return;
    setError(null);
    startTransition(async () => {
      const result = await verifyTenantSignup({ otpToken, code });
      if (!result.ok) {
        setError(result.error);
        toast({ title: "Couldn't verify code", description: result.error, variant: "error" });
        return;
      }
      toast({ title: "Workspace created", description: "Welcome aboard.", variant: "success" });
      router.push(result.redirectTo);
      router.refresh();
    });
  }

  if (otpToken) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-[var(--color-neutral-600)]">
          Enter the 6-digit code we sent to <span className="font-medium text-[var(--foreground)]">{sentToEmail}</span>.
        </p>
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
          {pending ? "Creating workspace…" : "Verify & create workspace"}
        </Button>
      </div>
    );
  }

  return (
    <form action={onSubmit} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="tenantName">Company name</Label>
        <Input
          id="tenantName"
          name="tenantName"
          value={tenantName}
          onChange={(e) => setTenantName(e.target.value)}
          required
          autoComplete="organization"
          placeholder="Acme Support"
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="slug">Workspace URL</Label>
        <div className="flex items-stretch">
          <Input
            id="slug"
            name="slug"
            value={slug}
            onChange={(e) => {
              setCustomSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""));
            }}
            required
            className="rounded-r-none"
            placeholder="acme"
          />
          <span className="inline-flex items-center px-3 rounded-r-lg border border-l-0 border-[var(--color-neutral-300)] bg-[var(--color-light-gray)] text-[13px] text-[var(--color-neutral-600)] whitespace-nowrap">
            .stralis.app
          </span>
        </div>
        <p className="text-[11px] text-[var(--color-neutral-500)]">
          Lowercase letters, numbers, and hyphens. This is how your team will reach the workspace.
        </p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="adminName">Your name</Label>
        <Input id="adminName" name="adminName" required autoComplete="name" />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="adminEmail">Work email</Label>
        <Input id="adminEmail" name="adminEmail" type="email" required autoComplete="email" />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="password">Password</Label>
        <Input id="password" name="password" type="password" required minLength={8} autoComplete="new-password" />
        <p className="text-[11px] text-[var(--color-neutral-500)]">{PASSWORD_RULES_HINT}</p>
      </div>
      {error && <p className="text-[13px] text-red-600">{error}</p>}
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Sending code…" : "Create workspace"}
      </Button>
      <p className="text-center text-[12px] text-[var(--color-neutral-500)]">
        Already have a workspace?{" "}
        <Link href="/auth/login" className="text-[var(--foreground)] font-medium hover:underline">
          Log in
        </Link>
      </p>
    </form>
  );
}
