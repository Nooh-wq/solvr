"use client";

import { useState, useTransition } from "react";
import {
  createWebhookSubscription,
  deleteWebhookSubscription,
} from "@/actions/webhookSubscriptions";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";

type Sub = {
  id: string;
  url: string;
  events: string[];
  isActive: boolean;
  failCount: number;
  disabledAt: Date | null;
  disabledReason: string | null;
  lastDeliveredAt: Date | null;
  createdAt: Date;
};

export function WebhooksForm({ subs, eventTypes }: { subs: Sub[]; eventTypes: string[] }) {
  const { toast } = useToast();
  const [rows, setRows] = useState(subs);
  const [creating, setCreating] = useState(false);
  const [url, setUrl] = useState("");
  const [selectedEvents, setSelectedEvents] = useState<string[]>([]);
  const [revealed, setRevealed] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function toggle(ev: string) {
    setSelectedEvents((s) => (s.includes(ev) ? s.filter((x) => x !== ev) : [...s, ev]));
  }

  function submit() {
    if (!url || selectedEvents.length === 0) return;
    startTransition(async () => {
      const r = await createWebhookSubscription({
        url,
        events: selectedEvents as ("ticket.created" | "ticket.updated" | "ticket.resolved" | "ticket.reopened" | "user.created" | "user.updated")[],
      });
      if (!r.ok) {
        toast({ title: "Couldn't create", description: r.error, variant: "error" });
        return;
      }
      setRevealed(r.secret);
      setRows((existing) => [
        {
          id: r.id, url, events: selectedEvents, isActive: true, failCount: 0,
          disabledAt: null, disabledReason: null, lastDeliveredAt: null, createdAt: new Date(),
        },
        ...existing,
      ]);
      setUrl("");
      setSelectedEvents([]);
      setCreating(false);
    });
  }

  function del(id: string) {
    startTransition(async () => {
      const r = await deleteWebhookSubscription(id);
      if (!r.ok) return;
      setRows((existing) => existing.filter((s) => s.id !== id));
    });
  }

  return (
    <div className="space-y-6 max-w-3xl">
      {revealed && (
        <div className="bg-yellow-50 dark:bg-yellow-500/5 border border-yellow-300 dark:border-yellow-500/30 rounded-2xl p-6 space-y-3">
          <h2 className="text-[15px] font-semibold">Signing secret — copy now, it won&apos;t be shown again.</h2>
          <code className="block font-mono text-[12px] bg-[var(--color-surface)] px-3 py-2 rounded-lg border border-[var(--color-neutral-300)] break-all">
            {revealed}
          </code>
          <p className="text-[12px] text-[var(--color-neutral-600)]">
            Verify incoming deliveries with HMAC-SHA256: <code>hmac(secret, `${'{'}timestamp{'}'}.${'{'}body{'}'}`)</code>. Signature is in <code>X-Stralis-Signature</code>.
          </p>
          <Button type="button" size="sm" onClick={() => setRevealed(null)}>I&apos;ve saved it</Button>
        </div>
      )}

      {!creating && (
        <Button onClick={() => setCreating(true)}>+ Add subscription</Button>
      )}

      {creating && (
        <div className="bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl p-6 space-y-4">
          <h2 className="text-[15px] font-semibold">New webhook subscription</h2>
          <div className="space-y-1.5">
            <Label htmlFor="whUrl">Endpoint URL</Label>
            <Input id="whUrl" type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://your-app.example.com/webhooks/stralis" />
          </div>
          <div className="space-y-2">
            <Label>Events</Label>
            {eventTypes.map((ev) => (
              <div key={ev} className="flex items-center gap-2">
                <input id={`ev-${ev}`} type="checkbox" checked={selectedEvents.includes(ev)} onChange={() => toggle(ev)} />
                <label htmlFor={`ev-${ev}`} className="text-[13px] font-mono">{ev}</label>
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <Button onClick={submit} disabled={pending || !url || selectedEvents.length === 0}>
              {pending ? "Creating…" : "Subscribe"}
            </Button>
            <Button type="button" variant="secondary" onClick={() => { setCreating(false); setUrl(""); setSelectedEvents([]); }}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      <div className="bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl overflow-hidden">
        <table className="w-full text-[13px]">
          <thead className="text-left border-b border-[var(--color-neutral-200)]">
            <tr>
              <th className="px-4 py-2">URL</th>
              <th className="px-4 py-2">Events</th>
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2">Last delivery</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-6 text-center text-[var(--color-neutral-500)]">No subscriptions yet.</td></tr>
            )}
            {rows.map((s) => (
              <tr key={s.id} className="border-b border-[var(--color-neutral-100)] dark:border-white/5">
                <td className="px-4 py-2 font-mono text-[11px] break-all">{s.url}</td>
                <td className="px-4 py-2 font-mono text-[11px]">{s.events.join(" ")}</td>
                <td className="px-4 py-2">
                  {s.isActive ? (
                    <span className="text-green-700 dark:text-green-400 text-[11px] font-semibold uppercase">Active</span>
                  ) : (
                    <span className="text-red-600 text-[11px] font-semibold uppercase" title={s.disabledReason ?? ""}>Disabled</span>
                  )}
                </td>
                <td className="px-4 py-2 text-[var(--color-neutral-600)]">
                  {s.lastDeliveredAt ? new Date(s.lastDeliveredAt).toLocaleDateString() : "never"}
                </td>
                <td className="px-4 py-2 text-right">
                  <button type="button" className="text-red-600 hover:underline" onClick={() => del(s.id)}>
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
