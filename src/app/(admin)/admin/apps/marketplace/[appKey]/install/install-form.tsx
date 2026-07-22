"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { upsertIntegration, type MarketplaceAppDto } from "@/actions/marketplace";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";

export function InstallForm({ app }: { app: MarketplaceAppDto }) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [displayName, setDisplayName] = useState(app.name);
  const [creds, setCreds] = useState<Record<string, string>>(
    Object.fromEntries(app.credentialFields.map((f) => [f.key, ""]))
  );
  const [meta, setMeta] = useState<Record<string, string>>(
    Object.fromEntries(app.metaFields.map((f) => [f.key, ""]))
  );

  function submit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      try {
        const res = await upsertIntegration({
          appKey: app.key,
          displayName,
          isActive: true,
          credentials: creds,
          meta,
        });
        if (res.testOk === false) {
          toast({
            title: "Installed, but test failed",
            description: res.testMessage ?? "Check credentials.",
            variant: "error",
          });
        } else {
          toast({ title: `${app.name} installed`, variant: "success" });
        }
        router.push("/admin/apps/installed");
      } catch (err) {
        toast({
          title: "Install failed",
          description: err instanceof Error ? err.message : undefined,
          variant: "error",
        });
      }
    });
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      <div>
        <label className="block text-[12px] uppercase-label text-[var(--color-neutral-700)] mb-1">
          Install name
        </label>
        <Input
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder={app.name}
          required
        />
        <p className="text-[11px] text-[var(--color-neutral-500)] mt-1">
          Shown wherever this install is referenced — e.g. escalation-path picker.
        </p>
      </div>

      {app.credentialFields.length > 0 ? (
        <fieldset className="space-y-4 border border-[var(--color-neutral-200)] rounded-xl p-4">
          <legend className="px-2 text-[11px] uppercase-label text-[var(--color-neutral-600)]">
            Credentials · encrypted at rest
          </legend>
          {app.credentialFields.map((f) => (
            <div key={f.key}>
              <label className="block text-[12px] font-medium mb-1">{f.label}</label>
              <Input
                type={f.isSecret ? "password" : "text"}
                autoComplete="off"
                value={creds[f.key] ?? ""}
                onChange={(e) => setCreds((c) => ({ ...c, [f.key]: e.target.value }))}
                required
              />
              {f.helpText ? (
                <p className="text-[11px] text-[var(--color-neutral-500)] mt-1">{f.helpText}</p>
              ) : null}
            </div>
          ))}
        </fieldset>
      ) : null}

      {app.metaFields.length > 0 ? (
        <fieldset className="space-y-4 border border-[var(--color-neutral-200)] rounded-xl p-4">
          <legend className="px-2 text-[11px] uppercase-label text-[var(--color-neutral-600)]">
            Configuration
          </legend>
          {app.metaFields.map((f) => (
            <div key={f.key}>
              <label className="block text-[12px] font-medium mb-1">{f.label}</label>
              <Input
                value={meta[f.key] ?? ""}
                placeholder={f.placeholder}
                onChange={(e) => setMeta((m) => ({ ...m, [f.key]: e.target.value }))}
              />
              {f.helpText ? (
                <p className="text-[11px] text-[var(--color-neutral-500)] mt-1">{f.helpText}</p>
              ) : null}
            </div>
          ))}
        </fieldset>
      ) : null}

      <div className="flex gap-2 pt-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Installing…" : "Install"}
        </Button>
      </div>
    </form>
  );
}
