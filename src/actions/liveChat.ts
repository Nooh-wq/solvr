"use server";

// M4.2 / M4.3 / M4.4 / M4.5 — live chat handoff, typing, agent console,
// offline fallback, convert-to-ticket.
//
// Spec §3 pins encoded here:
//   - Presence + conversations scoped by tenantId + withRls; no
//     cross-tenant leakage.
//   - Errors never log chat body — the catches drop message content.
//   - Offline fallback (no ONLINE agents) routes the handoff request
//     straight into escalateChatToTicket instead of hanging as
//     status=waiting.
//   - Composer is NOT rebuilt — the agent console reuses the same
//     MessageComposer used everywhere else in the app.

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withRls } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { chatSubjectWhereFor } from "@/lib/z1-dual-fk";
import { listOnlineAgentIds } from "@/actions/agentPresence";
import { escalateChatToTicket } from "@/actions/chat";

const idSchema = z.object({ conversationId: z.string().min(1) });
const typingSchema = z.object({
  conversationId: z.string().min(1),
  side: z.enum(["client", "agent"]),
});
const replySchema = z.object({
  conversationId: z.string().min(1),
  body: z.string().min(1).max(20_000),
});

export type LiveChatConversationDto = {
  id: string;
  status: string;
  handoffRequestedAt: string | null;
  handoffPickedUpAt: string | null;
  assignedTeamMemberId: string | null;
  clientTypingAt: string | null;
  agentTypingAt: string | null;
  ticketId: string | null;
  createdAt: string;
  messagePreview: string | null;
};

/**
 * M4.3 client-side action: "Talk to a person." Flips status → waiting
 * and stamps handoffRequestedAt. Routing (pick-up) is pull-based: the
 * agent console lists waiting conversations. Skill/availability
 * matching is deferred to the pick-up step.
 *
 * M4.4 offline fallback: if no ONLINE agents in the tenant, the
 * handoff falls straight through to escalateChatToTicket — the client
 * gets a ticket instead of a hanging "please wait" state.
 */
export async function requestLiveAgent(input: z.infer<typeof idSchema>) {
  const session = await requireSession();
  const { conversationId } = idSchema.parse(input);

  const online = await listOnlineAgentIds(session.tenantId);
  if (online.length === 0) {
    // Offline fallback — reuse existing convert-to-ticket path.
    const result = await escalateChatToTicket(conversationId);
    return { ok: true, kind: "offline-ticket" as const, ticketId: result.ticket.id };
  }

  return withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    async (tx) => {
      const conv = await tx.chatConversation.findFirstOrThrow({
        where: {
          id: conversationId,
          tenantId: session.tenantId,
          ...chatSubjectWhereFor(session.subjectId, session.role),
        },
      });
      if (conv.status === "live" || conv.status === "escalated") {
        return { ok: true, kind: "already-live" as const };
      }
      await tx.chatConversation.update({
        where: { id: conv.id },
        data: {
          status: "waiting",
          handoffRequestedAt: new Date(),
        },
      });
      revalidatePath("/agent/live-chat");
      return { ok: true, kind: "waiting" as const };
    }
  );
}

/**
 * M4.3 agent-side action: claim a waiting conversation. The
 * assignedTeamMemberId lock is enforced by the transaction — a stale
 * second click gets rejected because status flipped to "live" already.
 */
export async function pickUpLiveChat(input: z.infer<typeof idSchema>) {
  const session = await requireSession({ minRole: "AGENT" });
  const { conversationId } = idSchema.parse(input);
  return withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    async (tx) => {
      const conv = await tx.chatConversation.findFirst({
        where: {
          id: conversationId,
          tenantId: session.tenantId,
          status: "waiting",
        },
      });
      if (!conv) throw new Error("Conversation not available");
      await tx.chatConversation.update({
        where: { id: conv.id },
        data: {
          status: "live",
          assignedTeamMemberId: session.subjectId,
          handoffPickedUpAt: new Date(),
        },
      });
      revalidatePath("/agent/live-chat");
      return { ok: true };
    }
  );
}

/**
 * M4.3 agent posts a reply. Persists a ChatMessage row with the
 * agent's role (ADMIN if the caller is admin/super-admin, else AGENT).
 * The reusable ConversationThread on the client side already polls
 * ChatMessage rows, so nothing else needs to change to make it
 * "real-time" over the polling transport.
 */
export async function postAgentChatReply(input: z.infer<typeof replySchema>) {
  const session = await requireSession({ minRole: "AGENT" });
  const { conversationId, body } = replySchema.parse(input);
  return withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    async (tx) => {
      const conv = await tx.chatConversation.findFirst({
        where: {
          id: conversationId,
          tenantId: session.tenantId,
          status: "live",
          assignedTeamMemberId: session.subjectId,
        },
      });
      if (!conv) throw new Error("Not your conversation");
      const message = await tx.chatMessage.create({
        data: {
          conversationId: conv.id,
          role:
            session.role === "ADMIN" || session.role === "SUPER_ADMIN"
              ? "ADMIN"
              : "AGENT",
          body,
        },
      });
      // Clear the agent-typing timestamp on send.
      await tx.chatConversation.update({
        where: { id: conv.id },
        data: { agentTypingAt: null },
      });
      revalidatePath(`/agent/live-chat/${conv.id}`);
      return { ok: true, messageId: message.id };
    }
  );
}

/** M4.2 — stamp the correct typing timestamp. Cheap; called on keydown throttled by caller. */
export async function markTyping(input: z.infer<typeof typingSchema>) {
  const session = await requireSession();
  const { conversationId, side } = typingSchema.parse(input);
  return withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    async (tx) => {
      const data =
        side === "agent"
          ? { agentTypingAt: new Date() }
          : { clientTypingAt: new Date() };
      await tx.chatConversation.updateMany({
        where: { id: conversationId, tenantId: session.tenantId },
        data,
      });
      return { ok: true };
    }
  );
}

export async function listAgentLiveChats(): Promise<LiveChatConversationDto[]> {
  const session = await requireSession({ minRole: "AGENT" });
  return withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    async (tx) => {
      const rows = await tx.chatConversation.findMany({
        where: {
          tenantId: session.tenantId,
          status: { in: ["waiting", "live"] },
        },
        orderBy: [
          { status: "asc" }, // "live" < "waiting"
          { handoffRequestedAt: "asc" },
          { createdAt: "asc" },
        ],
        take: 100,
      });
      const previews = rows.length
        ? await tx.chatMessage.findMany({
            where: { conversationId: { in: rows.map((r) => r.id) } },
            orderBy: { createdAt: "desc" },
            distinct: ["conversationId"],
            select: { conversationId: true, body: true },
          })
        : [];
      const previewByConv = new Map(previews.map((p) => [p.conversationId, p.body]));
      return rows.map((r) => ({
        id: r.id,
        status: r.status,
        handoffRequestedAt: r.handoffRequestedAt?.toISOString() ?? null,
        handoffPickedUpAt: r.handoffPickedUpAt?.toISOString() ?? null,
        assignedTeamMemberId: r.assignedTeamMemberId,
        clientTypingAt: r.clientTypingAt?.toISOString() ?? null,
        agentTypingAt: r.agentTypingAt?.toISOString() ?? null,
        ticketId: r.ticketId,
        createdAt: r.createdAt.toISOString(),
        messagePreview: previewByConv.get(r.id)?.slice(0, 140) ?? null,
      }));
    }
  );
}

export async function getLiveChatDetail(input: z.infer<typeof idSchema>) {
  const session = await requireSession({ minRole: "AGENT" });
  const { conversationId } = idSchema.parse(input);
  return withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    async (tx) => {
      const conv = await tx.chatConversation.findFirst({
        where: { id: conversationId, tenantId: session.tenantId },
      });
      if (!conv) return null;
      const messages = await tx.chatMessage.findMany({
        where: { conversationId: conv.id },
        orderBy: { createdAt: "asc" },
      });
      return {
        id: conv.id,
        status: conv.status,
        assignedTeamMemberId: conv.assignedTeamMemberId,
        handoffRequestedAt: conv.handoffRequestedAt?.toISOString() ?? null,
        handoffPickedUpAt: conv.handoffPickedUpAt?.toISOString() ?? null,
        clientTypingAt: conv.clientTypingAt?.toISOString() ?? null,
        agentTypingAt: conv.agentTypingAt?.toISOString() ?? null,
        ticketId: conv.ticketId,
        messages: messages.map((m) => ({
          id: m.id,
          role: m.role as string,
          body: m.body,
          createdAt: m.createdAt.toISOString(),
        })),
      };
    }
  );
}

/**
 * M4.5 convert to ticket — delegates to the existing escalate action,
 * which already preserves the transcript in the created Ticket's
 * description. On success the conversation status flips to "escalated"
 * by that action.
 */
export async function convertLiveChatToTicket(input: z.infer<typeof idSchema>) {
  const session = await requireSession({ minRole: "AGENT" });
  const { conversationId } = idSchema.parse(input);
  void session; // requireSession's own tenant check is authoritative
  try {
    const result = await escalateChatToTicket(conversationId);
    return { ok: true, ticketId: result.ticket.id };
  } catch (e) {
    // Spec §3 pin: log ONLY the conversation id, never the body/error
    // detail that could include chat content.
    console.error("live-chat convert failed for conv", conversationId);
    void e;
    throw new Error("Convert failed");
  }
}
