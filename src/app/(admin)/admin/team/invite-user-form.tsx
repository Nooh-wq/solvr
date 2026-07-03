"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { inviteUser } from "@/actions/admin";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";

export function InviteUserForm() {
  const router = useRouter();
  const { toast } = useToast();
  const [error, setError] = useState<string | null>(null);
  const [tempPassword, setTempPassword] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(formData: FormData) {
    setError(null);
    setTempPassword(null);
    const name = String(formData.get("name"));
    startTransition(async () => {
      try {
        const result = await inviteUser({
          name,
          email: String(formData.get("email")),
          role: formData.get("role") as "CLIENT" | "AGENT" | "ADMIN",
        });
        if (!result.ok) {
          setError(result.error);
          toast({ title: "Couldn't send invite", description: result.error, variant: "error" });
          return;
        }
        setTempPassword(result.tempPassword);
        toast({ title: "Invite sent", description: `${name} can now log in.`, variant: "success" });
        router.refresh();
      } catch (e) {
        const message = e instanceof Error ? e.message : "Could not invite user.";
        setError(message);
        toast({ title: "Couldn't send invite", description: message, variant: "error" });
      }
    });
  }

  return (
    <div className="bg-white border border-[var(--color-neutral-300)] rounded p-5">
      <h3 className="text-[13px] font-semibold mb-4">Invite someone</h3>
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
        {tempPassword && (
          <p className="text-[12px] bg-[var(--color-orange-pale)] p-2 rounded">
            Account created. Temporary password: <span className="font-mono font-semibold">{tempPassword}</span>
            {" — an invite email was also sent (or logged, if email isn't configured)."}
          </p>
        )}
        <Button type="submit" className="w-full" disabled={pending}>
          {pending ? "Inviting…" : "Send invite"}
        </Button>
      </form>
    </div>
  );
}
