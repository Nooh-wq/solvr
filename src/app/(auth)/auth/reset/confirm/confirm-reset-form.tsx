"use client";

import { useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { confirmPasswordReset } from "@/actions/auth";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";

export function ConfirmResetForm() {
  const router = useRouter();
  const params = useSearchParams();
  const { toast } = useToast();
  const token = params.get("token") ?? "";
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!token) {
    return (
      <p className="text-sm text-[var(--color-neutral-600)]">
        This reset link is missing its token. Request a new one from the{" "}
        <Link href="/auth/reset" className="text-[var(--color-primary)] font-medium">
          reset password
        </Link>{" "}
        page.
      </p>
    );
  }

  function onSubmit(formData: FormData) {
    setError(null);
    const newPassword = String(formData.get("newPassword"));
    startTransition(async () => {
      const result = await confirmPasswordReset({ token, newPassword });
      if ("error" in result) {
        setError(result.error);
        toast({ title: "Couldn't reset password", description: result.error, variant: "error" });
        return;
      }
      toast({ title: "Password updated", variant: "success" });
      router.push(result.redirectTo ?? "/portal");
      router.refresh();
    });
  }

  return (
    <form action={onSubmit} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="newPassword">New password</Label>
        <Input id="newPassword" name="newPassword" type="password" required minLength={8} autoComplete="new-password" />
      </div>
      {error && <p className="text-[13px] text-red-600">{error}</p>}
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Updating…" : "Set new password"}
      </Button>
    </form>
  );
}
