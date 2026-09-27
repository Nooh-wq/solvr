"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { runIntegrationOnTicket } from "@/actions/marketplace";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";

type LinkRow = {
  id: string;
  externalKey: string;
  externalUrl: string;
  externalTitle: string | null;
  appName: string;
  integrationDisplayName: string;
  createdAt: string;
};

type IntegrationOption = {
  id: string;
  appName: string;
  displayName: string;
};

export function LinkedAppsPanel({
  ticketId,
  links,
  integrations,
}: {
  ticketId: string;
  links: LinkRow[];
  integrations: IntegrationOption[];
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [selected, setSelected] = useState<string>("");
  const [note, setNote] = useState("");

  function run() {
    if (!selected) return;
    startTransition(async () => {
      try {
        await runIntegrationOnTicket({ integrationId: selected, ticketId, note });
        toast({ title: "Linked object created", variant: "success" });
        setNote("");
        router.refresh();
      } catch (e) {
        toast({
          title: "Couldn't create link",
          description: e instanceof Error ? e.message : undefined,
          variant: "error",
        });
      }
    });
  }

  return (
    <div className="bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl p-4">
      <div className="text-[11px] uppercase-label text-[var(--color-neutral-600)] mb-2">
        Linked apps
      </div>
      {links.length === 0 ? (
        <p className="text-[12px] text-[var(--color-neutral-500)] mb-3">No linked external objects.</p>
      ) : (
        <ul className="space-y-2 mb-3">
          {links.map((l) => (
            <li key={l.id} className="text-[12px]">
              <a
                href={l.externalUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="underline break-all"
              >
                {l.appName}: {l.externalKey}
              </a>
              {l.externalTitle ? (
                <div className="text-[11px] text-[var(--color-neutral-500)]">{l.externalTitle}</div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {integrations.length === 0 ? (
        <p className="text-[11px] text-[var(--color-neutral-500)]">
          No installed integrations. Install one from Apps → Marketplace.
        </p>
      ) : (
        <div className="space-y-2">
          <select
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            className="w-full text-[12px] px-2 py-1.5 rounded-md border border-[var(--color-neutral-300)] bg-[var(--color-surface)]"
          >
            <option value="">Send to…</option>
            {integrations.map((i) => (
              <option key={i.id} value={i.id}>
                {i.appName}: {i.displayName}
              </option>
            ))}
          </select>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            placeholder="Optional note"
            className="w-full text-[12px] px-2 py-1.5 rounded-md border border-[var(--color-neutral-300)] bg-[var(--color-surface)] resize-none"
          />
          <Button size="sm" disabled={pending || !selected} onClick={run} className="w-full">
            {pending ? "Sending…" : "Send"}
          </Button>
        </div>
      )}
    </div>
  );
}
