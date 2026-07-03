"use client";

import { useState, useTransition } from "react";
import { requestPasswordReset } from "@/actions/auth";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";

export default function ResetPage() {
  const [sent, setSent] = useState(false);
  const [pending, startTransition] = useTransition();

  function onSubmit(formData: FormData) {
    startTransition(async () => {
      await requestPasswordReset({ email: String(formData.get("email")) });
      setSent(true);
    });
  }

  return (
    <div>
      <h1 className="text-lg font-bold mb-1">Reset password</h1>
      <p className="text-sm text-[var(--color-neutral-600)] mb-6">
        We&apos;ll email you a link to reset your password.
      </p>
      {sent ? (
        <p className="text-sm">If that email exists, a reset link is on its way.</p>
      ) : (
        <form action={onSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="email">Email</Label>
            <Input id="email" name="email" type="email" required autoComplete="email" />
          </div>
          <Button type="submit" className="w-full" disabled={pending}>
            {pending ? "Sending…" : "Send reset link"}
          </Button>
        </form>
      )}
    </div>
  );
}
