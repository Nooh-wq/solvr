/**
 * A message's displayed sender: a real User (agent/admin/client) via
 * `senderId`, or a guest (see prisma/schema.prisma's Message.guestId ->
 * TicketGuest) who never gets a User row, so falls back to their invited
 * name (or email, if they were never given one). Shared by every place that
 * maps a Prisma message row into ConversationThread's ConversationMessage
 * shape (getTicket()/getTicketMessages() in actions/tickets.ts,
 * getGuestTicketView()/getGuestTicketMessages() in actions/guest.ts).
 */
export function resolveMessageSender(m: {
  sender: { name: string; avatarUrl: string | null } | null;
  guest?: { name: string | null; email: string } | null;
}): { name: string; avatarUrl: string | null } | null {
  if (m.sender) return { name: m.sender.name, avatarUrl: m.sender.avatarUrl };
  if (m.guest) return { name: m.guest.name ?? m.guest.email, avatarUrl: null };
  return null;
}
