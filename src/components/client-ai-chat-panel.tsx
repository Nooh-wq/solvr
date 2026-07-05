"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { sendChatMessage, escalateChatToTicket } from "@/actions/chat";
import { Button } from "@/components/ui/button";
import { SparklesIcon } from "@/components/icons";
import { useToast } from "@/components/ui/toast";

type WidgetMessage = { role: "CLIENT" | "BOT"; body: string; citations?: string[] };

/**
 * Client-facing "Ask AI" box — same underlying chat protocol as the
 * floating ChatWidget (sendChatMessage/escalateChatToTicket), just embedded
 * in the ticket detail page's right column instead of a floating bubble,
 * and chat-only (no Summarize/Suggest reply — those read internal ticket
 * context an external client shouldn't see; see agent's CopilotPanel).
 */
export function ClientAiChatPanel() {
  const router = useRouter();
  const { toast } = useToast();
  const [conversationId, setConversationId] = useState<string | undefined>(undefined);
  const [messages, setMessages] = useState<WidgetMessage[]>([]);
  const [input, setInput] = useState("");
  const [notConfigured, setNotConfigured] = useState(false);
  const [transientError, setTransientError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  function send() {
    if (!input.trim()) return;
    const body = input.trim();
    setMessages((m) => [...m, { role: "CLIENT", body }]);
    setInput("");
    setTransientError(null);
    startTransition(async () => {
      const result = await sendChatMessage({ conversationId, body });
      if ("error" in result) {
        if (result.error === "RATE_LIMITED") {
          setTransientError("You're sending messages too quickly — please wait a moment and try again.");
        } else {
          setNotConfigured(true);
        }
        return;
      }
      setConversationId(result.conversationId);
      setMessages((m) => [...m, { role: "BOT", body: result.message.body, citations: result.message.citations }]);
    });
  }

  function escalate() {
    if (!conversationId) return;
    startTransition(async () => {
      await escalateChatToTicket(conversationId);
      toast({ title: "Ticket created from chat", variant: "success" });
      router.push("/portal");
      router.refresh();
    });
  }

  return (
    <div
      className="rounded-2xl border border-[var(--color-primary)]/30 bg-gradient-to-b from-[var(--color-orange-pale)] to-[var(--color-surface)] shadow-[0_8px_30px_-12px_var(--color-primary)] overflow-hidden flex flex-col"
      style={{ height: 360 }}
    >
      <div className="flex items-center gap-2.5 px-4 py-3 border-b border-[var(--color-primary)]/15 shrink-0">
        <span className="h-8 w-8 rounded-full bg-[var(--color-primary)] text-white flex items-center justify-center shadow-[0_4px_12px_-2px_var(--color-primary)] shrink-0">
          <SparklesIcon className="h-[18px] w-[18px]" />
        </span>
        <div className="min-w-0">
          <h3 className="text-[14px] font-bold leading-tight">Ask AI</h3>
          <p className="text-[11px] text-[var(--color-neutral-600)] leading-tight">Answers from our knowledge base</p>
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-2">
        {messages.length === 0 && !notConfigured && (
          <p className="text-[12px] text-[var(--color-neutral-600)]">
            Ask a question — we&apos;ll answer from our knowledge base, or help you open a new ticket.
          </p>
        )}
        {messages.map((m, i) => (
          <div
            key={i}
            className={
              m.role === "CLIENT"
                ? "ml-6 bg-[var(--color-surface)]/80 rounded-2xl px-3 py-2 text-[13px]"
                : "mr-6 bg-[var(--color-surface)] border border-black/5 dark:border-white/10 rounded-2xl px-3 py-2 text-[13px]"
            }
          >
            <p className="whitespace-pre-wrap">{m.body}</p>
            {m.citations && m.citations.length > 0 && (
              <p className="text-[10px] text-[var(--color-neutral-600)] mt-1">Source: {m.citations.join(", ")}</p>
            )}
          </div>
        ))}
        {notConfigured && (
          <p className="text-[12px] text-[var(--color-neutral-600)]">
            The AI assistant isn&apos;t configured yet — reply on the ticket directly instead.
          </p>
        )}
        {transientError && <p className="text-[12px] text-red-600">{transientError}</p>}
      </div>

      <div className="border-t border-[var(--color-primary)]/15 p-2 space-y-2 shrink-0">
        {conversationId && (
          <Button variant="secondary" size="sm" className="w-full" onClick={escalate} disabled={pending}>
            Create a new ticket from this chat
          </Button>
        )}
        <div className="flex gap-2">
          <input
            className="flex-1 h-9 px-2 text-[13px] border border-[var(--color-neutral-300)] rounded-xl bg-[var(--color-surface)] text-[var(--foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30"
            placeholder="Type a message…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && send()}
            disabled={notConfigured}
          />
          <Button size="sm" onClick={send} disabled={pending || !input.trim() || notConfigured}>
            Send
          </Button>
        </div>
      </div>
    </div>
  );
}
