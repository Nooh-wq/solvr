"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { registerClient } from "@/actions/auth";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";

export function RegisterForm() {
  const router = useRouter();
  const { toast } = useToast();
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState<{ autoApproved: boolean } | null>(null);
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
      if (result.ok !== true) {
        setError(result.error);
        toast({ title: "Couldn't create account", description: result.error, variant: "error" });
        return;
      }
      setSubmitted({ autoApproved: result.autoApproved });
    });
  }

  if (submitted) {
    return (
      <div className="space-y-4">
        <p className="text-[14px] text-[var(--color-neutral-800)]">
          {submitted.autoApproved
            ? "Your account is ready — you can log in now."
            : "Account created. An admin needs to approve your account before you can log in — we'll email you when that happens."}
        </p>
        <Button className="w-full" onClick={() => router.push("/auth/login")}>
          Go to login
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
      </div>
      {error && <p className="text-[13px] text-red-600">{error}</p>}
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Creating account…" : "Create account"}
      </Button>
    </form>
  );
}
