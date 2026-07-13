"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  pickUpLiveChat,
  postAgentChatReply,
  convertLiveChatToTicket,
  getLiveChatDetail,
  markTyping,
  type LiveChatConversationDto,
} from "@/actions/liveChat";
import { heartbeat, setPresenceStatus } from "@/actions/agentPresence";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";

const HEARTBEAT_MS = 30_000;
const POLL_MS = 4_000;

type Detail = Awaited<ReturnType<typeof getLiveChatDetail>>;

export function LiveChatConsole({
  conversations,
  presence,
}: {
  conversations: LiveChatConversationDto[];
  presence: string;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail>(null);
  const [status, setStatus] = useState(presence);
  const [reply, setReply] = useState("");

  // Heartbeat + refresh the console list on an interval.
  useEffect(() => {
    void heartbeat();
    const hb = setInterval(() => void heartbeat(), HEARTBEAT_MS);
    const poll = setInterval(() => router.refresh(), POLL_MS);
    return () => {
      clearInterval(hb);
      clearInterval(poll);
    };
  }, [router]);

  // Detail refresh when a conversation is open.
  useEffect(() => {
    if (!activeId) return;
    let alive = true;
    const load = async () => {
      const d = await getLiveChatDetail({ conversationId: activeId });
      if (alive) setDetail(d);
    };
    void load();
    const t = setInterval(load, POLL_MS);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [activeId]);

  function pickUp(id: string) {
    startTransition(async () => {
      try {
        await pickUpLiveChat({ conversationId: id });
        setActiveId(id);
        toast({ title: "Joined conversation", variant: "success" });
        router.refresh();
      } catch (e) {
        toast({
          title: "Couldn't pick up",
          description: e instanceof Error ? e.message : undefined,
          variant: "error",
        });
      }
    });
  }

  function send() {
    if (!activeId || !reply.trim()) return;
    startTransition(async () => {
      try {
        await postAgentChatReply({ conversationId: activeId, body: reply.trim() });
        setReply("");
        const d = await getLiveChatDetail({ conversationId: activeId });
        setDetail(d);
      } catch (e) {
        toast({
          title: "Couldn't send",
          description: e instanceof Error ? e.message : undefined,
          variant: "error",
        });
      }
    });
  }

  function convert() {
    if (!activeId) return;
    startTransition(async () => {
      try {
        await convertLiveChatToTicket({ conversationId: activeId });
        toast({ title: "Converted to ticket", variant: "success" });
        setActiveId(null);
        setDetail(null);
        router.refresh();
      } catch (e) {
        toast({
          title: "Convert failed",
          description: e instanceof Error ? e.message : undefined,
          variant: "error",
        });
      }
    });
  }

  function toggleStatus() {
    const next = status === "ONLINE" ? "AWAY" : "ONLINE";
    startTransition(async () => {
      try {
        await setPresenceStatus({ status: next });
        setStatus(next);
      } catch (e) {
        toast({
          title: "Couldn't update status",
          description: e instanceof Error ? e.message : undefined,
          variant: "error",
        });
      }
    });
  }

  const activeConv = conversations.find((c) => c.id === activeId);
  const clientTyping =
    detail?.clientTypingAt && Date.now() - new Date(detail.clientTypingAt).getTime() < 6000;

  return (
    <div className="grid grid-cols-12 gap-4">
      <aside className="col-span-4 space-y-3">
        <div className="flex items-center justify-between bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl p-3">
          <div>
            <div className="text-[11px] uppercase-label text-[var(--color-neutral-600)]">
              You&apos;re
            </div>
            <div className="text-[13px] font-semibold">
              {status === "ONLINE" ? "🟢 Online" : status === "AWAY" ? "🟡 Away" : "⚫ Offline"}
            </div>
          </div>
          <Button size="sm" variant="secondary" onClick={toggleStatus}>
            {status === "ONLINE" ? "Go away" : "Go online"}
          </Button>
        </div>

        <div className="bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl overflow-hidden">
          {conversations.length === 0 ? (
            <p className="p-6 text-center text-sm text-[var(--color-neutral-600)]">
              No waiting or live chats right now.
            </p>
          ) : (
            <ul>
              {conversations.map((c) => {
                const isActive = c.id === activeId;
                const isWaiting = c.status === "waiting";
                return (
                  <li
                    key={c.id}
                    className={`border-b border-[var(--color-neutral-100)] last:border-0 p-3 cursor-pointer ${
                      isActive ? "bg-[var(--color-light-gray)]" : "hover:bg-[var(--color-light-gray)]"
                    }`}
                    onClick={() => {
                      if (isWaiting) pickUp(c.id);
                      else setActiveId(c.id);
                    }}
                  >
                    <div className="flex justify-between items-baseline mb-1">
                      <span
                        className={`text-[11px] uppercase-label ${
                          isWaiting ? "text-amber-700" : "text-emerald-700"
                        }`}
                      >
                        {isWaiting ? "Waiting" : "Live"}
                      </span>
                      <span className="text-[11px] text-[var(--color-neutral-500)]">
                        {new Date(c.createdAt).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                    </div>
                    <div className="text-[13px] line-clamp-2 text-[var(--color-neutral-700)]">
                      {c.messagePreview ?? "(no messages yet)"}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </aside>

      <section className="col-span-8 bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl overflow-hidden">
        {!activeConv || !detail ? (
          <div className="p-12 text-center text-sm text-[var(--color-neutral-600)]">
            Pick a conversation from the list.
          </div>
        ) : (
          <div className="flex flex-col h-[70vh]">
            <div className="flex items-center justify-between p-4 border-b border-[var(--color-neutral-200)]">
              <div>
                <div className="text-[11px] uppercase-label text-[var(--color-neutral-600)]">
                  Conversation
                </div>
                <div className="text-[12px] font-mono text-[var(--color-neutral-700)]">
                  {activeConv.id.slice(0, 12)}…
                </div>
              </div>
              <Button variant="secondary" size="sm" disabled={pending} onClick={convert}>
                Convert to ticket
              </Button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {detail.messages.map((m) => (
                <div key={m.id} className="text-[13px]">
                  <div className="text-[10px] uppercase-label text-[var(--color-neutral-500)] mb-0.5">
                    {m.role} · {new Date(m.createdAt).toLocaleTimeString()}
                  </div>
                  <div>{m.body}</div>
                </div>
              ))}
              {clientTyping ? (
                <div className="text-[12px] italic text-[var(--color-neutral-500)]">
                  Client is typing…
                </div>
              ) : null}
            </div>
            <div className="p-3 border-t border-[var(--color-neutral-200)]">
              <Textarea
                rows={2}
                value={reply}
                onChange={(e) => {
                  setReply(e.target.value);
                  if (activeId) void markTyping({ conversationId: activeId, side: "agent" });
                }}
                placeholder="Reply as agent…"
              />
              <div className="mt-2 flex justify-end">
                <Button disabled={pending || !reply.trim()} onClick={send}>
                  Send
                </Button>
              </div>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
