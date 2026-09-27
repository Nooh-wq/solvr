"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { createScimToken, revokeScimToken } from "@/actions/scimTokens";

type Row = {
  id: string;
  name: string;
  createdAt: Date;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
};

export function ScimEditor({ initialTokens }: { initialTokens: Row[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [name, setName] = useState("");
  const [newToken, setNewToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function create(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setError(null);
    start(async () => {
      const res = await createScimToken({ name: name.trim() });
      if (!res.ok) {
        setError(res.error);
      } else {
        setNewToken(res.token);
        setName("");
        router.refresh();
      }
    });
  }

  function revoke(id: string, tokenName: string) {
    if (!confirm(`Revoke "${tokenName}"? Your IdP will lose access immediately.`)) return;
    setError(null);
    start(async () => {
      await revokeScimToken(id);
      router.refresh();
    });
  }

  return (
    <div className="space-y-6">
      {error ? (
        <div className="p-3 rounded-lg bg-[var(--color-danger)]/10 text-[var(--color-danger)] text-[13px]">
          {error}
        </div>
      ) : null}

      {newToken ? (
        <div className="p-4 rounded-2xl border-2 border-[var(--color-primary)] bg-[var(--color-primary)]/5">
          <div className="text-[11px] uppercase-label text-[var(--color-primary)] mb-1">
            Copy this token now — it won&apos;t be shown again
          </div>
          <code className="block text-[12px] font-mono break-all p-2 bg-[var(--color-surface)] rounded border border-[var(--color-neutral-300)]">
            {newToken}
          </code>
          <button
            type="button"
            onClick={() => {
              navigator.clipboard.writeText(newToken);
              setNewToken(null);
            }}
            className="mt-2 text-[12px] font-medium px-3 py-1.5 rounded-lg bg-[var(--color-primary)] text-[var(--color-on-primary)] cursor-pointer"
          >
            Copy & dismiss
          </button>
        </div>
      ) : null}

      <form
        onSubmit={create}
        className="p-4 bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl flex flex-wrap items-end gap-3"
      >
        <div className="flex-1 min-w-[240px]">
          <label className="text-[11px] uppercase-label text-[var(--color-neutral-600)]">Token name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Okta production"
            className="mt-1 w-full px-3 py-2 rounded-lg border border-[var(--color-neutral-300)] bg-transparent text-[13px]"
            maxLength={80}
          />
        </div>
        <button
          type="submit"
          disabled={pending || !name.trim()}
          className="text-[12px] font-medium px-4 py-2 rounded-lg bg-[var(--color-primary)] text-[var(--color-on-primary)] disabled:opacity-50 cursor-pointer"
        >
          Generate token
        </button>
      </form>

      {initialTokens.length === 0 ? (
        <div className="p-10 text-center text-[13px] text-[var(--color-neutral-600)] bg-[var(--color-surface)] border border-dashed border-[var(--color-neutral-300)] rounded-2xl">
          No SCIM tokens yet. Generate one above and paste it into your IdP&apos;s SCIM configuration.
        </div>
      ) : (
        <div className="bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-[var(--color-light-gray)] text-[11px] uppercase-label text-[var(--color-neutral-700)]">
              <tr>
                <th className="text-left font-semibold px-4 py-2.5">Name</th>
                <th className="text-left font-semibold px-4 py-2.5">Created</th>
                <th className="text-left font-semibold px-4 py-2.5">Last used</th>
                <th className="text-left font-semibold px-4 py-2.5">Status</th>
                <th className="text-right font-semibold px-4 py-2.5">Actions</th>
              </tr>
            </thead>
            <tbody>
              {initialTokens.map((t) => (
                <tr key={t.id} className="border-t border-[var(--color-neutral-100)]">
                  <td className="px-4 py-3 font-medium">{t.name}</td>
                  <td className="px-4 py-3 text-[var(--color-neutral-600)] font-mono text-[12px]">
                    {new Date(t.createdAt).toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-[var(--color-neutral-600)] font-mono text-[12px]">
                    {t.lastUsedAt ? new Date(t.lastUsedAt).toLocaleString() : "Never"}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`text-[11px] uppercase-label px-2 py-0.5 rounded-full ${
                        t.revokedAt
                          ? "bg-[var(--color-danger)]/10 text-[var(--color-danger)]"
                          : "bg-[var(--color-success)]/10 text-[var(--color-success)]"
                      }`}
                    >
                      {t.revokedAt ? "Revoked" : "Active"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {t.revokedAt ? (
                      <span className="text-[11px] text-[var(--color-neutral-500)]">—</span>
                    ) : (
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => revoke(t.id, t.name)}
                        className="text-[12px] font-medium px-3 py-1.5 rounded-lg border border-[var(--color-danger)] text-[var(--color-danger)] hover:bg-[var(--color-danger)]/10 cursor-pointer disabled:opacity-50"
                      >
                        Revoke
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
