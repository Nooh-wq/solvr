"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { deleteChannelConfig, upsertChannelConfig, type ChannelConfigDto } from "@/actions/channels";

export function VoiceEditor({ initialConfigs }: { initialConfigs: ChannelConfigDto[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<{
    phoneOrHandle: string;
    accountSid: string;
    authToken: string;
    isActive: boolean;
  }>({ phoneOrHandle: "", accountSid: "", authToken: "", isActive: true });

  function startNew() {
    setEditingId("__new__");
    setDraft({ phoneOrHandle: "", accountSid: "", authToken: "", isActive: true });
    setError(null);
    setMessage(null);
  }

  function startEdit(c: ChannelConfigDto) {
    setEditingId(c.id);
    setDraft({ phoneOrHandle: c.phoneOrHandle, accountSid: "", authToken: "", isActive: c.isActive });
    setError(null);
    setMessage(null);
  }

  function save() {
    setError(null);
    setMessage(null);
    start(async () => {
      try {
        await upsertChannelConfig({
          id: editingId === "__new__" ? undefined : editingId!,
          channel: "VOICE",
          phoneOrHandle: draft.phoneOrHandle,
          isActive: draft.isActive,
          credentials: {
            accountSid: draft.accountSid,
            authToken: draft.authToken,
          },
        });
        setMessage("Saved.");
        setEditingId(null);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Save failed.");
      }
    });
  }

  function remove(c: ChannelConfigDto) {
    if (!confirm(`Remove Voice channel for ${c.phoneOrHandle}?`)) return;
    setError(null);
    start(async () => {
      await deleteChannelConfig(c.id);
      router.refresh();
    });
  }

  return (
    <div className="space-y-6 max-w-3xl">
      {error ? (
        <div className="p-3 rounded-lg bg-[var(--color-danger)]/10 text-[var(--color-danger)] text-[13px]">
          {error}
        </div>
      ) : null}
      {message ? (
        <div className="p-3 rounded-lg bg-[var(--color-success)]/10 text-[var(--color-success)] text-[13px]">
          {message}
        </div>
      ) : null}

      {initialConfigs.length === 0 && editingId === null ? (
        <div className="p-8 text-center bg-[var(--color-surface)] border border-dashed border-[var(--color-neutral-300)] rounded-2xl">
          <p className="text-[13px] text-[var(--color-neutral-600)] mb-3">
            No Voice number configured yet.
          </p>
          <button
            type="button"
            onClick={startNew}
            className="text-[12px] font-medium px-4 py-2 rounded-lg bg-[var(--color-primary)] text-[var(--color-on-primary)] cursor-pointer"
          >
            Add Twilio Voice number
          </button>
        </div>
      ) : (
        <>
          {initialConfigs.map((c) => (
            <div
              key={c.id}
              className="p-4 bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl"
            >
              <div className="flex items-start justify-between mb-3">
                <div>
                  <div className="text-[15px] font-semibold">{c.phoneOrHandle}</div>
                  <div className="text-[11px] text-[var(--color-neutral-500)]">
                    Updated {new Date(c.updatedAt).toLocaleString()}
                  </div>
                </div>
                <span
                  className={`text-[11px] uppercase-label px-2 py-0.5 rounded-full ${
                    c.isActive
                      ? "bg-[var(--color-success)]/15 text-[var(--color-success)]"
                      : "bg-[var(--color-neutral-100)] text-[var(--color-neutral-600)]"
                  }`}
                >
                  {c.isActive ? "Active" : "Paused"}
                </span>
              </div>
              <div className="mb-3">
                <div className="text-[11px] uppercase-label text-[var(--color-neutral-600)] mb-1">
                  Twilio webhook URL
                </div>
                <code className="block text-[12px] font-mono break-all p-2 rounded bg-[var(--color-neutral-100)]">
                  {c.webhookUrl}
                </code>
                <div className="text-[11px] text-[var(--color-neutral-500)] mt-1">
                  Paste this into your Twilio number&apos;s Voice → &ldquo;A Call Comes In&rdquo; webhook.
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => startEdit(c)}
                  className="text-[12px] font-medium px-3 py-1.5 rounded-lg border border-[var(--color-neutral-300)] hover:bg-[var(--color-neutral-100)] cursor-pointer"
                >
                  Edit
                </button>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => remove(c)}
                  className="text-[12px] font-medium px-3 py-1.5 rounded-lg border border-[var(--color-danger)] text-[var(--color-danger)] hover:bg-[var(--color-danger)]/10 cursor-pointer disabled:opacity-50"
                >
                  Remove
                </button>
              </div>
            </div>
          ))}

          {editingId === null ? (
            <button
              type="button"
              onClick={startNew}
              className="text-[12px] font-medium px-4 py-2 rounded-lg bg-[var(--color-primary)] text-[var(--color-on-primary)] cursor-pointer"
            >
              Add another number
            </button>
          ) : null}
        </>
      )}

      {editingId !== null ? (
        <div className="p-5 bg-[var(--color-surface)] border-2 border-[var(--color-primary)] rounded-2xl space-y-3">
          <h3 className="text-[15px] font-semibold">
            {editingId === "__new__" ? "New Voice number" : "Edit Voice number"}
          </h3>

          <div>
            <label className="text-[11px] uppercase-label text-[var(--color-neutral-600)] block mb-1">
              Phone number (E.164)
            </label>
            <input
              value={draft.phoneOrHandle}
              onChange={(e) => setDraft({ ...draft, phoneOrHandle: e.target.value })}
              placeholder="+15551234567"
              className="w-full px-3 py-2 rounded-lg border border-[var(--color-neutral-300)] bg-transparent text-[13px] font-mono"
            />
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <label className="text-[11px] uppercase-label text-[var(--color-neutral-600)] block mb-1">
                Twilio Account SID
              </label>
              <input
                value={draft.accountSid}
                onChange={(e) => setDraft({ ...draft, accountSid: e.target.value })}
                placeholder={editingId === "__new__" ? "ACxxxx…" : "(leave blank to keep current)"}
                className="w-full px-3 py-2 rounded-lg border border-[var(--color-neutral-300)] bg-transparent text-[13px] font-mono"
              />
            </div>
            <div>
              <label className="text-[11px] uppercase-label text-[var(--color-neutral-600)] block mb-1">
                Twilio Auth Token
              </label>
              <input
                type="password"
                value={draft.authToken}
                onChange={(e) => setDraft({ ...draft, authToken: e.target.value })}
                placeholder={editingId === "__new__" ? "••••••••" : "(leave blank to keep current)"}
                className="w-full px-3 py-2 rounded-lg border border-[var(--color-neutral-300)] bg-transparent text-[13px] font-mono"
              />
            </div>
          </div>

          <label className="flex items-center gap-2 text-[13px]">
            <input
              type="checkbox"
              checked={draft.isActive}
              onChange={(e) => setDraft({ ...draft, isActive: e.target.checked })}
            />
            Accept inbound calls
          </label>

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setEditingId(null)}
              className="text-[12px] font-medium px-3 py-1.5 rounded-lg border border-[var(--color-neutral-300)] hover:bg-[var(--color-neutral-100)] cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={pending || !draft.phoneOrHandle.trim()}
              onClick={save}
              className="text-[12px] font-medium px-4 py-2 rounded-lg bg-[var(--color-primary)] text-[var(--color-on-primary)] disabled:opacity-50 cursor-pointer"
            >
              Save
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
