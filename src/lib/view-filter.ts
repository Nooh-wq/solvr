// Z6.1 — pure sync helper for translating a SavedView's filter shape
// into the ticket-filter shape actions/tickets.ts's ticketFilterSchema
// already accepts. Lives outside actions/views.ts because that file is
// "use server" and Next 16 rejects non-async exports there.

export type ViewFilters = {
  status?: string;
  priority?: string;
  categoryId?: string;
  assignedToId?: string;
  search?: string;
};

/**
 * Expands the `"me"` sentinel into the acting agent's id so the caller
 * doesn't need to know about it. `""` (empty) is kept as-is because the
 * downstream schema treats it as "no filter" (see emptyToUndefined in
 * lib/validation/ticket.ts).
 */
export function viewToTicketFilter(
  filters: ViewFilters,
  actingTeamMemberId: string
): Record<string, unknown> {
  const assignedToId =
    filters.assignedToId === "me"
      ? actingTeamMemberId
      : filters.assignedToId ?? "";
  return {
    status: filters.status,
    priority: filters.priority,
    categoryId: filters.categoryId,
    assignedToId,
    search: filters.search,
    page: 1,
  };
}
