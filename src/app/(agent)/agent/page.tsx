import { listAllTickets } from "@/actions/tickets";
import { QueueDirectory } from "./queue-directory";

export default async function AgentQueuePage() {
  // Fetched unfiltered — filtering happens instantly client-side in
  // QueueDirectory (same pattern as the Team directory), so there's no
  // "Filter" button to click and no round-trip per filter change.
  const tickets = await listAllTickets({});

  const open = tickets.filter((t) => t.status === "OPEN").length;
  const unassigned = tickets.filter((t) => !t.assignedToId).length;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Queue</h1>
        <div className="flex gap-4 text-[13px] text-[var(--color-neutral-600)]">
          <span>
            <strong className="text-black">{open}</strong> open
          </span>
          <span>
            <strong className="text-black">{unassigned}</strong> unassigned
          </span>
        </div>
      </div>

      <QueueDirectory
        tickets={tickets.map((t) => ({
          id: t.id,
          reference: t.reference,
          title: t.title,
          clientName: t.client.name,
          categoryName: t.category?.name ?? null,
          priority: t.priority,
          status: t.status,
          assigneeName: t.assignedTo?.name ?? null,
          updatedAt: t.updatedAt.toISOString(),
        }))}
      />
    </div>
  );
}
