"use client";

import { useState, useTransition } from "react";
import { createApiKey, revokeApiKey } from "@/actions/apiKeys";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";

type KeyRow = {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  createdAt: Date;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
};

export function ApiKeysForm({
  keys,
  catalog,
  allowed,
}: {
  keys: KeyRow[];
  catalog: Array<{ scope: string; label: string; description: string }>;
  allowed: string[];
}) {
  const { toast } = useToast();
  const [rows, setRows] = useState(keys);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [revealed, setRevealed] = useState<{ token: string; prefix: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const allowedSet = new Set(allowed);

  function toggle(scope: string) {
    setSelected((s) => (s.includes(scope) ? s.filter((x) => x !== scope) : [...s, scope]));
  }

  function submit() {
    if (!name || selected.length === 0) return;
    startTransition(async () => {
      const r = await createApiKey({ name, scopes: selected });
      if (!("ok" in r) || !r.ok) {
        toast({ title: "Couldn't create key", description: (r as {error: string}).error, variant: "error" });
        return;
      }
      setRevealed({ token: r.token, prefix: r.prefix });
      setRows((existing) => [
        {
          id: r.id,
          name,
          prefix: r.prefix,
          scopes: selected,
          createdAt: new Date(),
          lastUsedAt: null,
          revokedAt: null,
        },
        ...existing,
      ]);
      setName("");
      setSelected([]);
      setCreating(false);
    });
  }

  function revoke(id: string) {
    startTransition(async () => {
      const r = await revokeApiKey(id);
      if (!r.ok) {
        toast({ title: "Couldn't revoke", description: r.error, variant: "error" });
        return;
      }
      setRows((existing) => existing.map((k) => (k.id === id ? { ...k, revokedAt: new Date() } : k)));
      toast({ title: "Key revoked", variant: "success" });
    });
  }

  function copyToken() {
    if (!revealed) return;
    navigator.clipboard.writeText(revealed.token);
    toast({ title: "Copied", variant: "success" });
  }

  return (
    <div className="space-y-6 max-w-3xl">
      {revealed && (
        <div className="bg-yellow-50 dark:bg-yellow-500/5 border border-yellow-300 dark:border-yellow-500/30 rounded-2xl p-6 space-y-3">
          <h2 className="text-[15px] font-semibold">Copy your key now — it won&apos;t be shown again.</h2>
          <div className="flex items-center gap-2">
            <code className="flex-1 font-mono text-[12px] bg-[var(--color-surface)] px-3 py-2 rounded-lg border border-[var(--color-neutral-300)] break-all">
              {revealed.token}
            </code>
            <Button type="button" size="sm" variant="secondary" onClick={copyToken}>Copy</Button>
          </div>
          <Button type="button" size="sm" onClick={() => setRevealed(null)}>I&apos;ve saved it</Button>
        </div>
      )}

      {!creating && (
        <Button onClick={() => setCreating(true)}>+ Create key</Button>
      )}

      {creating && (
        <div className="bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl p-6 space-y-4">
          <h2 className="text-[15px] font-semibold">New API key</h2>
          <div className="space-y-1.5">
            <Label htmlFor="keyName">Name</Label>
            <Input id="keyName" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Monitoring integration" />
          </div>
          <div className="space-y-2">
            <Label>Scopes</Label>
            {catalog.map((s) => {
              const grantable = allowedSet.has(s.scope);
              return (
                <div key={s.scope} className="flex items-start gap-2">
                  <input
                    id={`scope-${s.scope}`}
                    type="checkbox"
                    checked={selected.includes(s.scope)}
                    disabled={!grantable}
                    onChange={() => toggle(s.scope)}
                    className="mt-1"
                  />
                  <label htmlFor={`scope-${s.scope}`} className={`text-[13px] ${grantable ? "" : "opacity-50"}`}>
                    <div className="font-medium font-mono text-[12px]">{s.scope}</div>
                    <div className="text-[var(--color-neutral-600)]">{s.description}{!grantable ? " — your role can't grant this" : ""}</div>
                  </label>
                </div>
              );
            })}
          </div>
          <div className="flex gap-2">
            <Button onClick={submit} disabled={pending || !name || selected.length === 0}>
              {pending ? "Creating…" : "Create"}
            </Button>
            <Button type="button" variant="secondary" onClick={() => { setCreating(false); setName(""); setSelected([]); }}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      <div className="bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl overflow-hidden">
        <table className="w-full text-[13px]">
          <thead className="text-left border-b border-[var(--color-neutral-200)]">
            <tr>
              <th className="px-4 py-2">Name</th>
              <th className="px-4 py-2">Prefix</th>
              <th className="px-4 py-2">Scopes</th>
              <th className="px-4 py-2">Last used</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-6 text-center text-[var(--color-neutral-500)]">No API keys yet.</td></tr>
            )}
            {rows.map((k) => (
              <tr key={k.id} className="border-b border-[var(--color-neutral-100)] dark:border-white/5">
                <td className="px-4 py-2 font-medium">{k.name}</td>
                <td className="px-4 py-2 font-mono text-[12px]">{k.prefix}…</td>
                <td className="px-4 py-2 font-mono text-[11px]">{k.scopes.join(" ")}</td>
                <td className="px-4 py-2 text-[var(--color-neutral-600)]">
                  {k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleDateString() : "never"}
                </td>
                <td className="px-4 py-2 text-right">
                  {k.revokedAt ? (
                    <span className="text-[11px] text-[var(--color-neutral-500)] uppercase">Revoked</span>
                  ) : (
                    <button type="button" className="text-red-600 hover:underline text-[13px]" onClick={() => revoke(k.id)}>
                      Revoke
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
