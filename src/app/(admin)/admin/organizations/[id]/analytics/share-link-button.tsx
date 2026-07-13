"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";

export function ShareLinkButton({
  organizationId,
  createLink,
}: {
  organizationId: string;
  createLink: (days: number) => Promise<{ url: string; expiresAt: string }>;
}) {
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [url, setUrl] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [days, setDays] = useState(30);

  function generate() {
    startTransition(async () => {
      try {
        const r = await createLink(days);
        setUrl(r.url);
        setExpiresAt(r.expiresAt);
      } catch (e) {
        toast({
          title: "Couldn't create link",
          description: e instanceof Error ? e.message : undefined,
          variant: "error",
        });
      }
    });
  }

  function copy() {
    if (!url) return;
    navigator.clipboard.writeText(url).then(
      () => toast({ title: "Copied", variant: "success" }),
      () => toast({ title: "Couldn't copy", variant: "error" })
    );
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex items-center gap-2">
        <label className="text-[12px] text-[var(--color-neutral-600)]">Expires in</label>
        <select
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
          className="h-9 rounded-md border border-[var(--color-neutral-300)] bg-[var(--color-surface)] px-2 text-sm"
        >
          <option value={7}>7 days</option>
          <option value={30}>30 days</option>
          <option value={90}>90 days</option>
        </select>
        <Button size="sm" onClick={generate} disabled={pending}>
          {pending ? "Generating…" : "Share as read-only link"}
        </Button>
      </div>
      {url ? (
        <div className="flex items-center gap-2 text-[12px]">
          <input
            readOnly
            value={url}
            className="w-96 h-8 rounded-md border border-[var(--color-neutral-300)] bg-[var(--color-surface)] px-2 font-mono"
            onFocus={(e) => e.currentTarget.select()}
          />
          <Button size="sm" variant="secondary" onClick={copy}>
            Copy
          </Button>
          {expiresAt ? (
            <span className="text-[var(--color-neutral-500)]">
              until {new Date(expiresAt).toLocaleDateString()}
            </span>
          ) : null}
        </div>
      ) : (
        <div className="text-[11px] text-[var(--color-neutral-500)]">
          Scoped to <span className="font-mono">{organizationId.slice(0, 8)}…</span> — recipients see only this org.
        </div>
      )}
    </div>
  );
}
