"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { inviteUser } from "@/actions/admin";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";

export function InviteUserForm({ embedded = false }: { embedded?: boolean }) {
  const router = useRouter();
  const { toast } = useToast();
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(formData: FormData) {
    setError(null);
    setSentTo(null);
    const name = String(formData.get("name"));
    const email = String(formData.get("email"));
    startTransition(async () => {
      try {
        const result = await inviteUser({ name, email, role: formData.get("role") as "CLIENT" | "AGENT" | "ADMIN" });
        if (!result.ok) {
          setError(result.error);
          toast({ title: "Couldn't send invite", description: result.error, variant: "error" });
          return;
        }
        setSentTo(email);
        toast({ title: "Invite sent", description: `${name} will get an email to set up their account.`, variant: "success" });
        router.refresh();
      } catch (e) {
        const message = e instanceof Error ? e.message : "Could not invite user.";
        setError(message);
        toast({ title: "Couldn't send invite", description: message, variant: "error" });
      }
    });
  }

  const form = (
    <form action={onSubmit} className="space-y-3">
        <div className="space-y-1">
          <Label htmlFor="name">Name</Label>
          <Input id="name" name="name" required />
        </div>
        <div className="space-y-1">
          <Label htmlFor="email">Email</Label>
          <Input id="email" name="email" type="email" required />
        </div>
        <div className="space-y-1">
          <Label htmlFor="role">Role</Label>
          <Select id="role" name="role" defaultValue="AGENT">
            <option value="CLIENT">Client</option>
            <option value="AGENT">Agent</option>
            <option value="ADMIN">Admin</option>
          </Select>
        </div>
        {error && <p className="text-[13px] text-red-600">{error}</p>}
        {sentTo && (
          <p className="text-[12px] bg-[var(--color-orange-pale)] p-2 rounded-xl">
            Invite sent to <span className="font-medium">{sentTo}</span> — they&apos;ll set their own password and verify a one-time code before their first login.
          </p>
        )}
        <Button type="submit" className="w-full" disabled={pending}>
          {pending ? "Inviting…" : "Send invite"}
        </Button>
      </form>
  );

  if (embedded) return form;

  return (
    <div className="bg-white border border-[var(--color-neutral-300)] rounded-2xl p-5">
      <h3 className="text-[13px] font-semibold mb-4">Invite someone</h3>
      {form}
    </div>
  );
}
