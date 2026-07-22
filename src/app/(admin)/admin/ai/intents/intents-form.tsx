"use client";

import { useState, useTransition } from "react";
import { upsertIntent, deleteIntent } from "@/actions/intentTaxonomy";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";

type Intent = {
  id: string;
  slug: string;
  label: string;
  description: string;
  isActive: boolean;
  sortOrder: number;
};

export function IntentsForm({ intents }: { intents: Intent[] }) {
  const { toast } = useToast();
  const [rows, setRows] = useState(intents);
  const [editing, setEditing] = useState<{ slug: string; label: string; description: string } | null>(null);
  const [pending, startTransition] = useTransition();

  function save() {
    if (!editing) return;
    startTransition(async () => {
      const r = await upsertIntent({
        slug: editing.slug,
        label: editing.label,
        description: editing.description,
        isActive: true,
        sortOrder: rows.length,
      });
      if (!r.ok) {
        toast({ title: "Couldn't save", description: r.error, variant: "error" });
        return;
      }
      const existing = rows.find((r) => r.slug === editing.slug);
      if (existing) {
        setRows((rs) =>
          rs.map((r) =>
            r.slug === editing.slug ? { ...r, label: editing.label, description: editing.description } : r
          )
        );
      } else {
        setRows((rs) => [...rs, { id: r.id, ...editing, isActive: true, sortOrder: rs.length }]);
      }
      setEditing(null);
      toast({ title: "Saved", variant: "success" });
    });
  }

  function del(id: string) {
    startTransition(async () => {
      await deleteIntent(id);
      setRows((rs) => rs.filter((r) => r.id !== id));
    });
  }

  return (
    <div className="space-y-6 max-w-3xl">
      {!editing && (
        <Button onClick={() => setEditing({ slug: "", label: "", description: "" })}>+ Add intent</Button>
      )}

      {editing && (
        <div className="bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl p-6 space-y-4">
          <h2 className="text-[15px] font-semibold">Intent</h2>
          <div className="space-y-1.5">
            <Label htmlFor="intentSlug">Slug (lowercase + underscore)</Label>
            <Input id="intentSlug" value={editing.slug} onChange={(e) => setEditing({ ...editing, slug: e.target.value })} placeholder="e.g. login_issue" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="intentLabel">Label</Label>
            <Input id="intentLabel" value={editing.label} onChange={(e) => setEditing({ ...editing, label: e.target.value })} placeholder="Login issue" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="intentDesc">Description (sent to the model)</Label>
            <textarea
              id="intentDesc"
              className="w-full text-[13px] bg-[var(--color-surface-muted)] border border-[var(--color-neutral-300)] rounded-lg px-2 py-1"
              rows={3}
              value={editing.description}
              onChange={(e) => setEditing({ ...editing, description: e.target.value })}
              placeholder="Trouble signing in — wrong password, locked account, 2FA issues, SSO problems."
            />
          </div>
          <div className="flex gap-2">
            <Button onClick={save} disabled={pending || !editing.slug || !editing.label || !editing.description}>
              {pending ? "Saving…" : "Save"}
            </Button>
            <Button type="button" variant="secondary" onClick={() => setEditing(null)}>Cancel</Button>
          </div>
        </div>
      )}

      <div className="bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl overflow-hidden">
        <table className="w-full text-[13px]">
          <thead className="text-left border-b border-[var(--color-neutral-200)]">
            <tr>
              <th className="px-4 py-2">Slug</th>
              <th className="px-4 py-2">Label</th>
              <th className="px-4 py-2">Description</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={4} className="px-4 py-6 text-center text-[var(--color-neutral-500)]">No intents configured yet.</td></tr>
            )}
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-[var(--color-neutral-100)] dark:border-white/5">
                <td className="px-4 py-2 font-mono text-[12px]">{r.slug}</td>
                <td className="px-4 py-2">{r.label}</td>
                <td className="px-4 py-2 text-[var(--color-neutral-600)]">{r.description}</td>
                <td className="px-4 py-2 text-right">
                  <button type="button" className="text-red-600 hover:underline" onClick={() => del(r.id)}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
