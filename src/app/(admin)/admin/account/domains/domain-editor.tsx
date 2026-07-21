"use client";

import { useState, useTransition } from "react";
import { updatePortalDomain } from "@/actions/accountSettings";

export function DomainEditor({ initialDomain }: { initialDomain: string }) {
  const [domain, setDomain] = useState(initialDomain);
  const [message, setMessage] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [pending, start] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    start(async () => {
      const res = await updatePortalDomain({ customDomain: domain });
      setMessage(res.ok ? { kind: "ok", text: "Saved." } : { kind: "err", text: res.error });
    });
  }

  return (
    <form
      onSubmit={submit}
      className="p-4 bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl flex flex-wrap items-end gap-3"
    >
      <div className="flex-1 min-w-[260px]">
        <label className="text-[11px] uppercase-label text-[var(--color-neutral-600)]">
          Portal hostname
        </label>
        <input
          value={domain}
          onChange={(e) => setDomain(e.target.value)}
          placeholder="support.acme.com"
          className="mt-1 w-full px-3 py-2 rounded-lg border border-[var(--color-neutral-300)] bg-transparent text-[13px] font-mono"
        />
      </div>
      {message ? (
        <span
          className={`text-[12px] ${
            message.kind === "ok" ? "text-[var(--color-success)]" : "text-[var(--color-danger)]"
          }`}
        >
          {message.text}
        </span>
      ) : null}
      <button
        type="submit"
        disabled={pending}
        className="text-[12px] font-medium px-4 py-2 rounded-lg bg-[var(--color-primary)] text-[var(--color-on-primary)] disabled:opacity-50 cursor-pointer"
      >
        Save
      </button>
    </form>
  );
}
