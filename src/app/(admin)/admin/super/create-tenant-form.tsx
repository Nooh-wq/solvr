"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createTenant } from "@/actions/super";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";

export function CreateTenantForm() {
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
        const result = await createTenant({
          name,
          slug: String(formData.get("slug")),
          adminName: String(formData.get("adminName")),
          adminEmail: String(formData.get("adminEmail")),
        });
        setTempPassword(result.tempPassword);
        toast({ title: "Tenant created", description: name, variant: "success" });
        router.refresh();
      } catch (e) {
        const message = e instanceof Error ? e.message : "Could not create tenant.";
        setError(message);
        toast({ title: "Couldn't create tenant", description: message, variant: "error" });
      }
    });
  }

  return (
    <div className="bg-white border border-[var(--color-neutral-300)] rounded p-5">
      <h3 className="text-[13px] font-semibold mb-4">Provision a tenant</h3>
      <form action={onSubmit} className="space-y-3">
        <div className="space-y-1">
          <Label htmlFor="name">Company name</Label>
          <Input id="name" name="name" required />
        </div>
        <div className="space-y-1">
          <Label htmlFor="slug">Slug</Label>
          <Input id="slug" name="slug" required placeholder="acme" pattern="[a-z0-9-]+" />
          <p className="text-[11px] text-[var(--color-neutral-600)]">acme.stralis.app once custom domains land</p>
        </div>
        <div className="space-y-1">
          <Label htmlFor="adminName">First admin — name</Label>
          <Input id="adminName" name="adminName" required />
        </div>
        <div className="space-y-1">
          <Label htmlFor="adminEmail">First admin — email</Label>
          <Input id="adminEmail" name="adminEmail" type="email" required />
        </div>
        {error && <p className="text-[13px] text-red-600">{error}</p>}
        {tempPassword && (
          <p className="text-[12px] bg-[var(--color-orange-pale)] p-2 rounded">
            Tenant created. Admin temp password: <span className="font-mono font-semibold">{tempPassword}</span>
          </p>
        )}
        <Button type="submit" className="w-full" disabled={pending}>
          {pending ? "Provisioning…" : "Create tenant"}
        </Button>
      </form>
    </div>
  );
}
