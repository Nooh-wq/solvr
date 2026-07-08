"use client";

import { useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { login } from "@/actions/auth";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const { toast } = useToast();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const result = await login({
        email: String(formData.get("email")),
        password: String(formData.get("password")),
      });
      if (result.error) {
        setError(result.error);
        toast({ title: "Couldn't log in", description: result.error, variant: "error" });
        return;
      }
      router.push(params.get("next") ?? result.redirectTo ?? "/portal");
      router.refresh();
    });
  }

  // M21.2 — surfaces a one-time notice when the user has just confirmed an
  // email change (confirmEmailChange redirects with ?emailChanged=1). The
  // banner is silent otherwise, so it doesn't add noise to normal logins.
  const emailChanged = params.get("emailChanged") === "1";

  return (
    <form action={onSubmit} className="space-y-4">
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
