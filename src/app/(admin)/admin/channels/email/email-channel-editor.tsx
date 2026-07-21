"use client";

import { useState, useTransition } from "react";
import { updateEmailChannel } from "@/actions/emailChannel";

export function EmailChannelEditor({
  initialSupportEmail,
  initialEmailFromName,
  initialEmailDomain,
}: {
  initialSupportEmail: string;
  initialEmailFromName: string;
  initialEmailDomain: string;
}) {
  const [supportEmail, setSupportEmail] = useState(initialSupportEmail);
  const [fromName, setFromName] = useState(initialEmailFromName);
  const [domain, setDomain] = useState(initialEmailDomain);
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    start(async () => {
      const res = await updateEmailChannel({
        supportEmail,
        emailFromName: fromName,
        emailDomain: domain,
      });
      setMessage(res.ok ? { kind: "ok", text: "Saved." } : { kind: "err", text: res.error });
    });
  }

  return (
    <form
      onSubmit={submit}
      className="max-w-3xl p-5 bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl space-y-4"
    >
      <div>
        <label className="text-[11px] uppercase-label text-[var(--color-neutral-600)] block mb-1">
          Inbound support address
        </label>
        <input
          type="email"
          value={supportEmail}
          onChange={(e) => setSupportEmail(e.target.value)}
          placeholder="support@acme.com"
          className="w-full px-3 py-2 rounded-lg border border-[var(--color-neutral-300)] bg-transparent text-[13px] font-mono"
        />
        <div className="text-[11px] text-[var(--color-neutral-500)] mt-1">
          Email sent to this address becomes a ticket in your workspace.
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <label className="text-[11px] uppercase-label text-[var(--color-neutral-600)] block mb-1">
            From name (outbound)
          </label>
          <input
            value={fromName}
            onChange={(e) => setFromName(e.target.value)}
            placeholder="Acme Support"
            className="w-full px-3 py-2 rounded-lg border border-[var(--color-neutral-300)] bg-transparent text-[13px]"
            maxLength={80}
          />
        </div>
        <div>
          <label className="text-[11px] uppercase-label text-[var(--color-neutral-600)] block mb-1">
            Sending domain
          </label>
          <input
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            placeholder="acme.com"
            className="w-full px-3 py-2 rounded-lg border border-[var(--color-neutral-300)] bg-transparent text-[13px] font-mono"
          />
          <div className="text-[11px] text-[var(--color-neutral-500)] mt-1">
            Verify DKIM / SPF for this domain in your Resend dashboard.
          </div>
        </div>
      </div>

      {message ? (
        <div
          className={`text-[13px] ${
            message.kind === "ok" ? "text-[var(--color-success)]" : "text-[var(--color-danger)]"
          }`}
        >
          {message.text}
        </div>
      ) : null}

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={pending}
          className="text-[12px] font-medium px-4 py-2 rounded-lg bg-[var(--color-primary)] text-[var(--color-on-primary)] disabled:opacity-50 cursor-pointer"
        >
          Save changes
        </button>
      </div>
    </form>
  );
}
