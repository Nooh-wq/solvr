"use client";

import { useState, useTransition } from "react";
import { updateChatbotConfig, type ChatbotConfigRow } from "@/actions/workspaceSettings";

export function ChatbotEditor({ initialConfig }: { initialConfig: ChatbotConfigRow }) {
  const [cfg, setCfg] = useState<ChatbotConfigRow>(initialConfig);
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  function save() {
    setMessage(null);
    start(async () => {
      const res = await updateChatbotConfig(cfg);
      setMessage(res.ok ? { kind: "ok", text: "Saved." } : { kind: "err", text: res.error });
    });
  }

  return (
    <div className="max-w-3xl p-5 bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl space-y-4">
      <label className="flex items-center gap-2 text-[13px] font-medium">
        <input
          type="checkbox"
          checked={cfg.isEnabled}
          onChange={(e) => setCfg({ ...cfg, isEnabled: e.target.checked })}
        />
        Chat widget enabled on the portal
      </label>

      <div>
        <label className="text-[11px] uppercase-label text-[var(--color-neutral-600)] block mb-1">
          Persona
        </label>
        <input
          value={cfg.persona}
          onChange={(e) => setCfg({ ...cfg, persona: e.target.value })}
          placeholder="a friendly support assistant"
          className="w-full px-3 py-2 rounded-lg border border-[var(--color-neutral-300)] bg-transparent text-[13px]"
          maxLength={200}
        />
        <div className="text-[11px] text-[var(--color-neutral-500)] mt-1">
          Injected into the system prompt as &ldquo;You are {"{persona}"}.&rdquo;
        </div>
      </div>

      <div>
        <label className="text-[11px] uppercase-label text-[var(--color-neutral-600)] block mb-1">
          System prompt (optional)
        </label>
        <textarea
          value={cfg.systemPrompt ?? ""}
          onChange={(e) => setCfg({ ...cfg, systemPrompt: e.target.value || null })}
          rows={4}
          placeholder="Additional instructions (tone, response length, restricted topics)…"
          className="w-full px-3 py-2 rounded-lg border border-[var(--color-neutral-300)] bg-transparent text-[13px] font-mono"
          maxLength={4000}
        />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <label className="flex items-start gap-2 text-[13px]">
          <input
            type="checkbox"
            className="mt-1"
            checked={cfg.deflectFirst}
            onChange={(e) => setCfg({ ...cfg, deflectFirst: e.target.checked })}
          />
          <span>
            <strong>Deflect first</strong>
            <div className="text-[11px] text-[var(--color-neutral-500)]">
              Try to answer from KB before offering to open a ticket.
            </div>
          </span>
        </label>
        <div>
          <label className="text-[11px] uppercase-label text-[var(--color-neutral-600)] block mb-1">
            Escalate after (turns)
          </label>
          <input
            type="number"
            min={1}
            max={20}
            value={cfg.escalateAfter}
            onChange={(e) => setCfg({ ...cfg, escalateAfter: Number(e.target.value) || 3 })}
            className="w-24 px-3 py-2 rounded-lg border border-[var(--color-neutral-300)] bg-transparent text-[13px] font-mono"
          />
          <div className="text-[11px] text-[var(--color-neutral-500)] mt-1">
            Turns without a KB match before the widget offers &ldquo;Talk to a person&rdquo;.
          </div>
        </div>
      </div>

      <div>
        <label className="text-[11px] uppercase-label text-[var(--color-neutral-600)] block mb-1">
          Allowed topics (optional)
        </label>
        <input
          value={cfg.allowedTopics ?? ""}
          onChange={(e) => setCfg({ ...cfg, allowedTopics: e.target.value || null })}
          placeholder="billing, product usage, account access"
          className="w-full px-3 py-2 rounded-lg border border-[var(--color-neutral-300)] bg-transparent text-[13px]"
          maxLength={500}
        />
        <div className="text-[11px] text-[var(--color-neutral-500)] mt-1">
          If set, the widget refuses to answer questions outside these topics.
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
          type="button"
          disabled={pending}
          onClick={save}
          className="text-[12px] font-medium px-4 py-2 rounded-lg bg-[var(--color-primary)] text-[var(--color-on-primary)] disabled:opacity-50 cursor-pointer"
        >
          Save changes
        </button>
      </div>
    </div>
  );
}
