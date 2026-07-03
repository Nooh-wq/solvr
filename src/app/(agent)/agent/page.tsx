import Link from "next/link";
import { listAllTickets } from "@/actions/tickets";
import { StatusBadge, PriorityLabel } from "@/components/ui/badge";

export default async function AgentQueuePage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; priority?: string; search?: string; assignedToId?: string }>;
}) {
  const sp = await searchParams;
  const tickets = await listAllTickets({
    status: sp.status as never,
    priority: sp.priority as never,
    search: sp.search,
    assignedToId: sp.assignedToId,
  });

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

      <form className="flex gap-2 mb-5 overflow-x-auto" action="/agent">
        <input
          name="search"
          defaultValue={sp.search}
          placeholder="Search title or client…"
          className="h-9 px-3 text-sm border border-[var(--color-neutral-300)] rounded w-64"
        />
        <select name="status" defaultValue={sp.status ?? ""} className="h-9 px-2 text-sm border border-[var(--color-neutral-300)] rounded">
          <option value="">All statuses</option>
          <option value="OPEN">Open</option>
          <option value="IN_PROGRESS">In progress</option>
          <option value="PENDING">Pending</option>
          <option value="RESOLVED">Resolved</option>
          <option value="CLOSED">Closed</option>
        </select>
        <select name="priority" defaultValue={sp.priority ?? ""} className="h-9 px-2 text-sm border border-[var(--color-neutral-300)] rounded">
          <option value="">All priorities</option>
          <option value="LOW">Low</option>
          <option value="MEDIUM">Medium</option>
          <option value="HIGH">High</option>
          <option value="URGENT">Urgent</option>
        </select>
        <button type="submit" className="h-9 px-4 text-sm rounded-full bg-black text-white">
          Filter
        </button>
      </form>

      <div className="bg-white border border-[var(--color-neutral-300)] rounded overflow-hidden">
        {tickets.length === 0 ? (
          <p className="p-8 text-center text-sm text-[var(--color-neutral-600)]">No tickets match these filters.</p>
        ) : (
          <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-[var(--color-light-gray)] text-[11px] uppercase-label text-[var(--color-neutral-700)]">
              <tr>
                <th className="text-left font-semibold px-4 py-2.5">Reference</th>
                <th className="text-left font-semibold px-4 py-2.5">Title</th>
                <th className="text-left font-semibold px-4 py-2.5">Client</th>
                <th className="text-left font-semibold px-4 py-2.5">Category</th>
                <th className="text-left font-semibold px-4 py-2.5">Priority</th>
                <th className="text-left font-semibold px-4 py-2.5">Status</th>
                <th className="text-left font-semibold px-4 py-2.5">Assignee</th>
                <th className="text-left font-semibold px-4 py-2.5">Updated</th>
              </tr>
            </thead>
            <tbody>
              {tickets.map((t) => (
                <tr key={t.id} className="border-t border-[var(--color-neutral-100)] hover:bg-[var(--color-light-gray)]">
                  <td className="px-4 py-3">
                    <Link href={`/agent/tickets/${t.id}`} className="font-mono text-[12px] text-[var(--color-primary)]">
                      {t.reference}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <Link href={`/agent/tickets/${t.id}`}>{t.title}</Link>
                  </td>
                  <td className="px-4 py-3 text-[var(--color-neutral-600)]">{t.client.name}</td>
                  <td className="px-4 py-3 text-[var(--color-neutral-600)]">{t.category?.name ?? "—"}</td>
                  <td className="px-4 py-3">
                    <PriorityLabel priority={t.priority} />
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={t.status} />
                  </td>
                  <td className="px-4 py-3 text-[var(--color-neutral-600)]">{t.assignedTo?.name ?? "Unassigned"}</td>
                  <td className="px-4 py-3 text-[var(--color-neutral-600)]">
                    {new Date(t.updatedAt).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </div>
    </div>
  );
}
