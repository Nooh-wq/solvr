"use client";

import { useState, useTransition } from "react";
import { summarizeTicket, suggestReply } from "@/actions/copilot";
import { Button } from "@/components/ui/button";

export function CopilotPanel({ ticketId }: { ticketId: string }) {
  const [summary, setSummary] = useState<string | null>(null);
  const [reply, setReply] = useState<{ text: string; citations: string[] } | null>(null);
  const [notConfigured, setNotConfigured] = useState(false);
  const [pending, startTransition] = useTransition();

  function runSummarize() {
    startTransition(async () => {
      const result = await summarizeTicket(ticketId);
      if ("error" in result) {
        setNotConfigured(true);
        return;
      }
      setSummary(result.summary);
    });
  }

  function runSuggestReply() {
    startTransition(async () => {
      const result = await suggestReply(ticketId);
      if ("error" in result) {
        setNotConfigured(true);
        return;
      }
      setReply({ text: result.reply, citations: result.citations });
    });
  }

  return (
    <div className="mt-6 bg-white border border-[var(--color-neutral-300)] rounded p-4">
      <h3 className="text-[13px] font-semibold mb-3">AI copilot</h3>

      {notConfigured ? (
        <p className="text-[12px] text-[var(--color-neutral-600)]">
          Not configured yet — set `ANTHROPIC_API_KEY` in `.env` to enable summaries and suggested replies.
        </p>
      ) : (
        <div className="space-y-3">
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={runSummarize} disabled={pending}>
              Summarize
            </Button>
            <Button variant="secondary" size="sm" onClick={runSuggestReply} disabled={pending}>
              Suggest reply
            </Button>
          </div>

          {summary && (
            <div className="bg-[var(--color-light-gray)] rounded p-3">
              <p className="uppercase-label text-[10px] text-[var(--color-neutral-600)] mb-1">Summary</p>
              <p className="text-[13px]">{summary}</p>
            </div>
          )}

          {reply && (
            <div className="bg-[var(--color-orange-pale)] rounded p-3">
              <p className="uppercase-label text-[10px] text-[var(--color-neutral-600)] mb-1">Suggested reply (draft — review before sending)</p>
              <p className="text-[13px] whitespace-pre-wrap">{reply.text}</p>
              {reply.citations.length > 0 && (
                <p className="text-[10px] text-[var(--color-neutral-600)] mt-2">Grounded in: {reply.citations.join(", ")}</p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
