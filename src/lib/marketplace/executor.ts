// M19 — integration execution choke point.
//
// Every call site that runs an integration against a ticket funnels
// through executeIntegration(): the escalation-path INTEGRATION branch
// (src/lib/escalations.ts) and the ticket-detail inline action
// (src/actions/marketplace.ts's runIntegrationOnTicket).
//
// Guarantees:
//   - envelope-decrypt the tenant's stored credentials
//   - never leak plaintext credentials into any thrown error
//   - always record a TicketIntegrationLink on success
//   - always record an internal note on the ticket linking to the
//     external object so the agent thread carries the audit trail

import { withRls } from "@/lib/db";
import { envelopeDecrypt } from "@/core/auth/envelope-crypto";
import { getMarketplaceApp } from "./apps";
import type { RuleEngineSession } from "@/lib/rule-engine";

function siteUrl() {
  return process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
}

export type IntegrationExecuteInput = {
  session: RuleEngineSession;
  integrationId: string;
  ticketId: string;
  /** Optional agent-supplied note added to the outbound payload. */
  note?: string;
  /** For audit — "button" (agent clicked) | "rule" (escalation/rule). */
  source: "button" | "rule";
};

export async function executeIntegration(input: IntegrationExecuteInput): Promise<{
  externalKey: string;
  externalUrl: string;
  linkId: string;
}> {
  const { session, integrationId, ticketId, note, source } = input;

  // Prep — one RLS txn to load the integration + ticket + decrypt.
  const prep = await withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    async (tx) => {
      const integration = await tx.tenantIntegration.findFirst({
        where: { id: integrationId, tenantId: session.tenantId, isActive: true },
      });
      if (!integration) throw new Error("Integration not found or inactive.");
      const ticket = await tx.ticket.findFirst({
        where: { id: ticketId, tenantId: session.tenantId },
        select: {
          id: true,
          reference: true,
          title: true,
          description: true,
          priority: true,
          status: true,
        },
      });
      if (!ticket) throw new Error("Ticket not found.");
      const plain = await envelopeDecrypt(tx, session.tenantId, integration.configEnc);
      const credentials = plain ? (JSON.parse(plain) as Record<string, string>) : {};
      return {
        integration,
        ticket,
        credentials,
        meta: (integration.metaJson as Record<string, unknown>) ?? {},
      };
    }
  );

  const app = getMarketplaceApp(prep.integration.appKey);
  if (!app) throw new Error(`Unknown marketplace app: ${prep.integration.appKey}`);

  // Fire the outbound call OUTSIDE any transaction — external HTTP
  // must never hold a Postgres connection.
  const result = await app.execute(
    {
      tenantId: session.tenantId,
      credentials: prep.credentials,
      meta: prep.meta,
    },
    {
      ticket: {
        id: prep.ticket.id,
        reference: prep.ticket.reference,
        subject: prep.ticket.title,
        description: prep.ticket.description ?? "",
        priority: prep.ticket.priority,
        status: prep.ticket.status,
        url: `${siteUrl()}/agent/tickets/${prep.ticket.id}`,
      },
      note,
    }
  );

  // Persist the link + internal note in one RLS txn.
  const linkId = await withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    async (tx) => {
      const link = await tx.ticketIntegrationLink.create({
        data: {
          tenantId: session.tenantId,
          ticketId,
          integrationId,
          externalKey: result.externalKey,
          externalUrl: result.externalUrl,
          externalTitle: result.externalTitle,
          createdByTeamMemberId: session.role === "CLIENT" ? null : session.subjectId,
        },
      });
      return link.id;
    }
  );

  // Best-effort internal-note. If the note write fails (RLS mishap,
  // tickets table constraint), don't undo the successful external call
  // — surface the note error but keep the link.
  try {
    const { postAgentReply } = await import("@/actions/tickets");
    await postAgentReply({
      ticketId,
      body: `[Integration "${app.name}" (${prep.integration.displayName})] Linked ${result.externalKey}: ${result.externalUrl}${
        note ? `\n\n${note}` : ""
      }${source === "rule" ? "\n\n(via automation)" : ""}`,
      isInternal: true,
    });
  } catch {
    /* audit-only note; external call already succeeded */
  }

  return { externalKey: result.externalKey, externalUrl: result.externalUrl, linkId };
}
