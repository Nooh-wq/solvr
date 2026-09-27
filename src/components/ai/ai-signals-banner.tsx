"use client";

// M9 — the agent-facing AI signals banner on the ticket detail page.
// Renders the M9.1-M9.3 signals with M9.4 confidence gating: below the
// threshold, tags render muted with a "low confidence" note; agents can
// click any tag to override via the M9.4 override UI (M9.4).
//
// The banner is intentionally compact — a single line under the ticket
// header. Agents scan for tone before they read.

import { useState, useTransition } from "react";
import { overrideMessageSignals } from "@/actions/aiOverride";
import { useToast } from "@/components/ui/toast";

export type AiSignals = {
  messageId: string;
  intent: string | null;
  sentiment: string | null;
  urgency: string | null;
  language: string | null;
  confidence: number | null;
  overridden: boolean;
};

const SENTIMENTS = ["positive", "neutral", "negative", "frustrated", "angry"];
const URGENCIES = ["low", "medium", "high", "critical"];

export function AiSignalsBanner({
  signals,
  intentLabels,
  confidenceThreshold,
}: {
  signals: AiSignals;
  intentLabels: Record<string, string>;
  confidenceThreshold: number;
}) {
  const { toast } = useToast();
  const [current, setCurrent] = useState(signals);
  const [editing, setEditing] = useState<null | "intent" | "sentiment" | "urgency">(null);
  const [pending, startTransition] = useTransition();

  const belowThreshold =
    !current.overridden &&
    typeof current.confidence === "number" &&
    current.confidence < confidenceThreshold;

  if (!current.intent && !current.sentiment && !current.urgency && !current.language) {
    return (
      <div className="text-[11px] text-[var(--color-neutral-500)]">
        AI signals: pending…
      </div>
    );
  }

  function overrideOne(patch: Partial<{ intent: string; sentiment: string; urgency: string }>) {
    startTransition(async () => {
      const r = await overrideMessageSignals({ messageId: current.messageId, ...patch });
      if (!r.ok) {
        toast({ title: "Couldn't override", description: r.error, variant: "error" });
        return;
      }
      setCurrent({ ...current, ...patch, overridden: true, confidence: 1 });
      setEditing(null);
      toast({ title: "Signal updated", variant: "success" });
    });
  }

  const tone = belowThreshold ? "text-[var(--color-neutral-500)]" : "text-[var(--color-neutral-700)]";
  const chip = "text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded-md";

  return (
    <div className={`text-[11px] flex items-center gap-2 flex-wrap ${tone}`}>
      <span className="uppercase tracking-wide text-[10px]">AI:</span>
      {/* Intent */}
      {current.intent && (
        <button
          type="button"
          onClick={() => setEditing(editing === "intent" ? null : "intent")}
          className={`${chip} bg-[var(--color-primary)]/10 text-[var(--color-primary)] hover:bg-[var(--color-primary)]/20`}
        >
          {intentLabels[current.intent] ?? current.intent}
        </button>
      )}
      {editing === "intent" && (
        <select
          className="text-[11px] px-1 py-0.5 rounded"
          disabled={pending}
          onChange={(e) => overrideOne({ intent: e.target.value })}
          defaultValue=""
        >
          <option value="" disabled>Change intent…</option>
          {Object.entries(intentLabels).map(([slug, label]) => (
            <option key={slug} value={slug}>{label}</option>
          ))}
        </select>
      )}

      {/* Sentiment */}
      {current.sentiment && (
        <button
          type="button"
          onClick={() => setEditing(editing === "sentiment" ? null : "sentiment")}
          className={`${chip} bg-[var(--color-neutral-200)]/50 dark:bg-white/10 hover:bg-[var(--color-neutral-200)]`}
        >
          {current.sentiment}
        </button>
      )}
      {editing === "sentiment" && (
        <select
          className="text-[11px] px-1 py-0.5 rounded"
          disabled={pending}
          onChange={(e) => overrideOne({ sentiment: e.target.value })}
          defaultValue=""
        >
          <option value="" disabled>Change…</option>
          {SENTIMENTS.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      )}

      {/* Urgency */}
      {current.urgency && (
        <button
          type="button"
          onClick={() => setEditing(editing === "urgency" ? null : "urgency")}
          className={`${chip} bg-[var(--color-neutral-200)]/50 dark:bg-white/10 hover:bg-[var(--color-neutral-200)]`}
        >
          {current.urgency} urgency
        </button>
      )}
      {editing === "urgency" && (
        <select
          className="text-[11px] px-1 py-0.5 rounded"
          disabled={pending}
          onChange={(e) => overrideOne({ urgency: e.target.value })}
          defaultValue=""
        >
          <option value="" disabled>Change…</option>
          {URGENCIES.map((u) => (
            <option key={u} value={u}>{u}</option>
          ))}
        </select>
      )}

      {/* Language */}
      {current.language && (
        <span className="text-[10px] text-[var(--color-neutral-500)]">· {current.language}</span>
      )}

      {/* Confidence */}
      {typeof current.confidence === "number" && (
        <span className="text-[10px] text-[var(--color-neutral-500)]">
          · {Math.round(current.confidence * 100)}% confidence
        </span>
      )}

      {belowThreshold && (
        <span className="text-[10px] italic text-[var(--color-neutral-500)]">
          (low confidence)
        </span>
      )}

      {current.overridden && (
        <span className="text-[10px] italic text-[var(--color-primary)]">
          · edited by agent
        </span>
      )}
    </div>
  );
}
