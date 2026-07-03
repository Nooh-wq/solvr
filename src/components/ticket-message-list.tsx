import { cn } from "@/lib/utils";

export type ThreadMessage = {
  id: string;
  body: string;
  senderRole: string;
  isInternal: boolean;
  createdAt: Date;
  sender: { name: string } | null;
};

export function TicketMessageList({ messages }: { messages: ThreadMessage[] }) {
  if (messages.length === 0) {
    return <p className="text-sm text-[var(--color-neutral-600)] mb-6">No replies yet.</p>;
  }

  return (
    <div className="space-y-3 mb-6">
      {messages.map((m) => (
        <div
          key={m.id}
          className={cn(
            "rounded p-4 border text-sm",
            m.isInternal
              ? "bg-[var(--color-orange-pale)] border-[var(--color-orange-core)]/30"
              : m.senderRole === "CLIENT"
              ? "bg-white border-[var(--color-neutral-300)]"
              : "bg-[var(--color-light-gray)] border-[var(--color-neutral-300)]"
          )}
        >
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[12px] font-semibold">
              {m.sender?.name ?? m.senderRole}
              {m.isInternal && <span className="ml-2 uppercase-label text-[10px] text-[var(--color-orange-deep)]">Internal note</span>}
            </span>
            <span className="text-[11px] font-mono text-[var(--color-neutral-600)]">
              {new Date(m.createdAt).toLocaleString()}
            </span>
          </div>
          <p className="whitespace-pre-wrap">{m.body}</p>
        </div>
      ))}
    </div>
  );
}
