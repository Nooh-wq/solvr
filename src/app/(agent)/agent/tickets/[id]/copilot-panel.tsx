"use client";

import { useState, useTransition } from "react";
import { summarizeTicket, suggestReply } from "@/actions/copilot";
import { SparklesIcon } from "@/components/icons";

export function CopilotPanel({ ticketId }: { ticketId: string }) {
  const [summary, setSummary] = useState<string | null>(null);
  const [reply, setReply] = useState<{ text: string; citations: string[] } | null>(null);
  const [notConfigured, setNotConfigured] = useState(false);
  const [pending, startTransition] = useTransition();
  const [action, setAction] = useState<"summary" | "reply" | null>(null);

  function runSummarize() {
    setAction("summary");
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
    setAction("reply");
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
    <div className="mt-6 rounded-2xl border border-[var(--color-primary)]/30 bg-gradient-to-b from-[var(--color-orange-pale)] to-[var(--color-surface)] shadow-[0_8px_30px_-12px_var(--color-primary)] overflow-hidden">
      <div className="flex items-center gap-2.5 px-4 py-3 border-b border-[var(--color-primary)]/15">
        <span className="h-8 w-8 rounded-full bg-[var(--color-primary)] text-white flex items-center justify-center shadow-[0_4px_12px_-2px_var(--color-primary)] shrink-0">
          <SparklesIcon className="h-[18px] w-[18px]" />
        </span>
        <div className="min-w-0">
          <h3 className="text-[14px] font-bold leading-tight">AI copilot</h3>
          <p className="text-[11px] text-[var(--color-neutral-600)] leading-tight">Summaries &amp; draft replies from your knowledge base</p>
        </div>
      </div>

      <div className="p-4">
        {notConfigured ? (
          <p className="text-[12px] text-[var(--color-neutral-600)]">
            Not configured yet — set <code className="font-mono">ANTHROPIC_API_KEY</code> in <code className="font-mono">.env</code> to enable summaries and suggested replies.
          </p>
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={runSummarize}
                disabled={pending}
                className="flex items-center justify-center h-10 rounded-full bg-[var(--color-primary)] text-white text-[13px] font-semibold shadow-[0_4px_14px_-4px_var(--color-primary)] hover:brightness-105 active:scale-[0.98] transition-all duration-150 cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {pending && action === "summary" ? "Summarizing…" : "Summarize"}
              </button>
              <button
                onClick={runSuggestReply}
                disabled={pending}
                className="flex items-center justify-center h-10 rounded-full bg-[var(--color-surface)] border border-[var(--color-primary)]/40 text-[var(--color-primary)] text-[13px] font-semibold hover:bg-[var(--color-orange-pale)] active:scale-[0.98] transition-all duration-150 cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {pending && action === "reply" ? "Drafting…" : "Suggest reply"}
              </button>
            </div>

            {summary && (
              <div className="bg-[var(--color-surface)]/80 border border-black/5 dark:border-white/10 rounded-xl p-3">
                <p className="uppercase-label text-[10px] text-[var(--color-neutral-600)] mb-1">Summary</p>
                <p className="text-[13px] leading-relaxed">{summary}</p>
              </div>
            )}

            {reply && (
              <div className="bg-[var(--color-surface)]/80 border border-[var(--color-primary)]/20 rounded-xl p-3">
                <p className="uppercase-label text-[10px] text-[var(--color-neutral-600)] mb-1">Suggested reply — review before sending</p>
                <p className="text-[13px] whitespace-pre-wrap leading-relaxed">{reply.text}</p>
                {reply.citations.length > 0 && (
                  <p className="text-[10px] text-[var(--color-neutral-600)] mt-2">Grounded in: {reply.citations.join(", ")}</p>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
