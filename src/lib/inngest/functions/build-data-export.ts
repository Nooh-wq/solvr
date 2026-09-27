// M21.6 — builds the data export payload for a requesting user, stores
// it on the DataExportRequest row, signs a 72-hour download token, and
// emails the link. Triggered by src/actions/dangerZone.ts's
// requestDataExport().

import { inngest } from "../client";
import { withRls, prisma } from "@/lib/db";
import { signPurposeToken } from "@/core/auth/tokens";
import { sendSystemNotice } from "@/lib/email/send";
import {
  systemContext,
  getEndUser,
  getTeamMember,
} from "@/lib/shared-platform";

const EXPORT_TTL_MS = 72 * 60 * 60 * 1000;

function siteUrl() {
  return process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
}

export const buildDataExport = inngest.createFunction(
  { id: "build-data-export", triggers: { event: "danger-zone/data-export.requested" } },
  async ({ event, step }) => {
    const { requestId, tenantId, subjectId } = event.data as {
      requestId: string;
      tenantId: string;
      subjectId: string;
    };

    const payload = await step.run("collect", async () => {
      // Best-effort resolve identity via wrapper. If the subject was
      // already deactivated between request and drain, we still export
      // whatever we can — this is their own data.
      const ctx = systemContext(tenantId);
      const [endUser, teamMember] = await Promise.all([
        getEndUser(ctx, subjectId),
        getTeamMember(ctx, subjectId),
      ]);
      const profile = endUser
        ? { kind: "END_USER" as const, id: endUser.id, name: endUser.name, email: endUser.email }
        : teamMember
          ? { kind: "TEAM_MEMBER" as const, id: teamMember.id, name: teamMember.name, email: teamMember.email }
          : { kind: "UNKNOWN" as const, id: subjectId };

      return withRls({ tenantId, userId: subjectId, role: "SUPER_ADMIN" }, async (tx) => {
        // Everything visible to this subject: tickets they created,
        // messages they wrote, notification prefs, avatar url, custom
        // field values keyed to them. Kept as a single JSON object —
        // small even for heavy users.
        const [tickets, messages, prefs, avatar, sessions, loginHistory] = await Promise.all([
          tx.ticket.findMany({
            where: {
              tenantId,
              OR: [{ clientEndUserId: subjectId }, { clientTeamMemberId: subjectId }],
            },
            select: {
              id: true,
              reference: true,
              title: true,
              description: true,
              status: true,
              priority: true,
              createdAt: true,
              resolvedAt: true,
            },
          }),
          tx.message.findMany({
            where: {
              tenantId,
              OR: [{ senderEndUserId: subjectId }, { senderTeamMemberId: subjectId }],
            },
            select: {
              id: true,
              ticketId: true,
              body: true,
              isInternal: true,
              createdAt: true,
            },
          }),
          tx.notificationPreference.findUnique({ where: { subjectId } }),
          tx.subjectAvatar.findUnique({ where: { subjectId } }),
          tx.userSession.findMany({
            where: { tenantId, subjectId, expiresAt: { gt: new Date() } },
            select: {
              id: true,
              userAgent: true,
              ipAddress: true,
              createdAt: true,
              lastActiveAt: true,
            },
          }),
          tx.loginActivity.findMany({
            where: { tenantId, subjectId },
            orderBy: { createdAt: "desc" },
            take: 100,
            select: {
              userAgent: true,
              ipAddress: true,
              country: true,
              createdAt: true,
            },
          }),
        ]);
        return {
          exportedAt: new Date().toISOString(),
          profile,
          tickets,
          messages,
          notificationPreferences: prefs,
          avatarUrl: avatar?.avatarUrl ?? null,
          activeSessions: sessions,
          loginHistory,
        };
      });
    });

    const expiresAt = new Date(Date.now() + EXPORT_TTL_MS);
    await step.run("store", async () => {
      await withRls({ tenantId, userId: subjectId, role: "SUPER_ADMIN" }, (tx) =>
        tx.dataExportRequest.update({
          where: { id: requestId },
          data: {
            status: "READY",
            payload,
            expiresAt,
          },
        })
      );
    });

    const token = await signPurposeToken("data-export", { requestId, tenantId, subjectId });
    const downloadUrl = `${siteUrl()}/api/data-export/${encodeURIComponent(token)}`;

    await step.run("email-link", async () => {
      const branding = await prisma.tenantBranding.findUnique({ where: { tenantId } });
      const email =
        (payload.profile as { email?: string }).email ??
        null;
      if (!email) return;
      const productName = branding?.productName ?? "Support";
      await sendSystemNotice({
        to: email,
        branding,
        subject: `Your ${productName} data export is ready`,
        heading: "Your data export is ready",
        body: `We packaged up your account data. The link below stops working after 72 hours.`,
        ctaLabel: "Download",
        ctaUrl: downloadUrl,
      });
    });

    return { requestId, expiresAt: expiresAt.toISOString() };
  }
);
