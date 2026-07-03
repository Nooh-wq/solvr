"use client";

import { useState, useTransition, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { sendChatMessage, escalateChatToTicket } from "@/actions/chat";
import { Button } from "@/components/ui/button";
import { ChatIcon, CloseIcon } from "@/components/icons";

type WidgetMessage = { role: "CLIENT" | "BOT"; body: string; citations?: string[] };

export function ChatWidget() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
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
        // NOT_CONFIGURED / DISABLED are terminal (disable the input);
        // RATE_LIMITED is transient (let them retry after a moment).
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
      router.push("/portal");
      router.refresh();
    });
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-6 right-6 h-12 w-12 rounded-full bg-[var(--color-primary)] text-white shadow-[0_8px_24px_-6px_var(--color-primary)] flex items-center justify-center transition-all duration-150 hover:-translate-y-0.5 hover:shadow-[0_12px_28px_-6px_var(--color-primary)] active:scale-95 cursor-pointer"
        aria-label="Open chat"
      >
        <ChatIcon className="h-5 w-5" />
      </button>
    );
  }

  return (
    <div className="fixed bottom-6 right-6 w-80 glass-panel rounded-2xl shadow-[0_16px_48px_-12px_rgba(0,0,0,0.25)] flex flex-col animate-[fadeIn_150ms_ease-out]" style={{ height: 420 }}>
      <div className="h-11 border-b border-black/5 flex items-center justify-between px-3">
        <span className="text-[13px] font-semibold">Chat with us</span>
        <button
          onClick={() => setOpen(false)}
          aria-label="Close chat"
          className="h-7 w-7 flex items-center justify-center rounded-lg text-[var(--color-neutral-600)] hover:bg-black/[0.045] hover:text-black transition-colors duration-150 cursor-pointer"
        >
          <CloseIcon className="h-4 w-4" />
        </button>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-2">
        {messages.length === 0 && (
          <p className="text-[12px] text-[var(--color-neutral-600)]">Ask a question — we&apos;ll answer from our knowledge base, or help you open a ticket.</p>
        )}
        {messages.map((m, i) => (
          <div
            key={i}
            className={
              m.role === "CLIENT"
                ? "ml-8 bg-[var(--color-light-gray)] rounded px-3 py-2 text-[13px]"
                : "mr-8 bg-[var(--color-orange-pale)] rounded px-3 py-2 text-[13px]"
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
            The chatbot isn&apos;t configured yet (no Anthropic API key) — please use &quot;New ticket&quot; instead.
          </p>
        )}
        {transientError && <p className="text-[12px] text-red-600">{transientError}</p>}
      </div>

      <div className="border-t border-black/5 p-2 space-y-2">
        {conversationId && (
          <Button variant="secondary" size="sm" className="w-full" onClick={escalate} disabled={pending}>
            Create a ticket from this chat
          </Button>
        )}
        <div className="flex gap-2">
          <input
            className="flex-1 h-9 px-2 text-[13px] border border-[var(--color-neutral-300)] rounded"
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
