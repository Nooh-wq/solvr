import { listAllTickets } from "@/actions/tickets";
import { getSlaForTickets } from "@/actions/sla";
import {
  listMyViews,
  ensureDefaultSharedViews,
  countViewMatches,
} from "@/actions/views";
import { viewToTicketFilter } from "@/lib/view-filter";
import { requireSession, roleAtLeast } from "@/lib/auth";
import { withRls } from "@/lib/db";
import { QueueWorkspace } from "./queue-workspace";

// Z6.1 — the queue is now the fallback surface behind Views. Landing
// on /agent picks the acting agent's default view (or "All tickets"
// when they haven't saved any views yet) and runs it. A ?view=<id>
// URL param overrides the default so a bookmarked view keeps working.

type SearchParams = Promise<{ view?: string }>;

export default async function AgentQueuePage({
  searchParams,
}: {
  searchParams?: SearchParams;
}) {
  const session = await requireSession({ minRole: "AGENT" });
  const sp = (await (searchParams ?? Promise.resolve({}))) as { view?: string };

  // Z6.5 — lazy seed defaults on first load. Best-effort: an error
  // here shouldn't block the queue from rendering.
  try {
    await ensureDefaultSharedViews();
  } catch {
    // Non-fatal.
  }
  const [views, viewCounts] = await Promise.all([
    listMyViews(),
    countViewMatches(),
  ]);
  const activeView =
    (sp.view && views.find((v) => v.id === sp.view)) ||
    views.find((v) => v.isDefault) ||
    null;

  const filter = activeView
    ? viewToTicketFilter(activeView.filters, session.subjectId)
    : {};
  const tickets = await listAllTickets(filter);

  // M2.3 — batch-load SLA rows for the visible tickets so each row
  // can render its badge without a per-row query. Graceful degrade
  // (empty map) if no policy is configured for this tenant yet.
  const slaByTicketId = await getSlaForTickets(tickets.map((t) => t.id));

  const open = tickets.filter((t) => t.status === "OPEN").length;
  const unassigned = tickets.filter((t) => !t.assignedTeamMemberId).length;

  // M3 — agent's own availability for the header chip. Fresh accounts
  // with no AgentProfile row default to Available (matches routing
  // engine's fallback).
  let initialAvailable = true;
  if (session.subjectId) {
    const ap = await withRls(
      { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
      (tx) =>
        tx.agentProfile.findFirst({
          where: { tenantId: session.tenantId, teamMemberId: session.subjectId! },
          select: { isAvailable: true },
        })
    );
    if (ap) initialAvailable = ap.isAvailable;
  }

  return (
    <QueueWorkspace
      initialAvailable={initialAvailable}
      canShareViews={roleAtLeast(session.role, "ADMIN")}
      views={views.map((v) => ({
        id: v.id,
        name: v.name,
        isDefault: v.isDefault,
        isShared: v.isShared,
        count: viewCounts[v.id] ?? 0,
        filters: v.filters,
        sort: v.sort,
      }))}
      activeViewId={activeView?.id ?? null}
      tickets={tickets.map((t) => ({
        id: t.id,
        reference: t.reference,
        title: t.title,
        clientName: t.client?.name ?? "Unknown",
        categoryName: t.category?.name ?? null,
        priority: t.priority,
        status: t.status,
        assigneeName: t.assignedTo?.name ?? null,
        updatedAt: t.updatedAt.toISOString(),
        sla: slaByTicketId[t.id] ?? [],
      }))}
      openCount={open}
      unassignedCount={unassigned}
    />
  );
}
