"use server";

// M-admin — Landing dashboard data. Powers the 6 cards on /admin.
// Read-only aggregation; keep it cheap (single RLS txn, no cross-
// tenant reads except the Super-Admin health card which the page
// gates on role before requesting).

import { withRls } from "@/lib/db";
import { requireSession } from "@/lib/auth";

export type AdminLandingData = {
  setup: {
    brandingConfigured: boolean;
    ssoConfigured: boolean;
    hasCustomField: boolean;
    hasRule: boolean;
    hasBusinessCalendar: boolean;
    doneCount: number;
    totalCount: number;
  };
  recentActivity: Array<{
    id: string;
    action: string;
    actor: string | null;
    fromValue: string | null;
    toValue: string | null;
    createdAt: string;
  }>;
  pending: {
    peopleAwaitingApproval: number;
    kbSuggestions: number;
    aiActionsAwaitingApproval: number;
    accountDeletionRequests: number;
    approvalRequests: number;
  };
};

export async function getAdminLandingData(): Promise<AdminLandingData> {
  const session = await requireSession({ minRole: "ADMIN" });
  return withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    async (tx) => {
      const [
        branding,
        idp,
        cfCount,
        ruleCount,
        calCount,
        auditRows,
        pendingCustomerCount,
        kbSuggCount,
        aiActionCount,
        deletionCount,
        approvalCount,
      ] = await Promise.all([
        tx.tenantBranding.findUnique({ where: { tenantId: session.tenantId } }),
        tx.tenantIdentityProvider.findFirst({ where: { tenantId: session.tenantId } }),
        tx.customFieldDefinition.count({ where: { tenantId: session.tenantId } }),
        tx.rule.count({ where: { tenantId: session.tenantId } }),
        tx.businessCalendar.count({ where: { tenantId: session.tenantId } }),
        tx.auditLog.findMany({
          where: { tenantId: session.tenantId },
          orderBy: { createdAt: "desc" },
          take: 10,
          select: {
            id: true,
            action: true,
            fromValue: true,
            toValue: true,
            createdAt: true,
            actorTeamMemberId: true,
            actorEndUserId: true,
          },
        }),
        tx.endUserLifecycle.count({ where: { tenantId: session.tenantId, status: "PENDING" } }),
        tx.kbSuggestion.count({ where: { tenantId: session.tenantId, status: "PENDING" } }),
        tx.aiActionLog
          .count({ where: { tenantId: session.tenantId, status: "PENDING" } })
          .catch(() => 0),
        tx.accountDeletionRequest.count({
          where: { tenantId: session.tenantId, status: "PENDING" },
        }),
        tx.approvalRequest
          .count({ where: { tenantId: session.tenantId, status: "PENDING" } })
          .catch(() => 0),
      ]);

      const brandingConfigured = !!(branding && (branding.logoUrl || branding.productName !== "Support"));
      const ssoConfigured = !!idp;
      const hasCustomField = cfCount > 0;
      const hasRule = ruleCount > 0;
      const hasBusinessCalendar = calCount > 0;
      const doneCount = [
        brandingConfigured,
        ssoConfigured,
        hasCustomField,
        hasRule,
        hasBusinessCalendar,
      ].filter(Boolean).length;

      return {
        setup: {
          brandingConfigured,
          ssoConfigured,
          hasCustomField,
          hasRule,
          hasBusinessCalendar,
          doneCount,
          totalCount: 5,
        },
        recentActivity: auditRows.map((r) => ({
          id: r.id,
          action: r.action,
          actor: r.actorTeamMemberId ?? r.actorEndUserId ?? null,
          fromValue: r.fromValue,
          toValue: r.toValue,
          createdAt: r.createdAt.toISOString(),
        })),
        pending: {
          peopleAwaitingApproval: pendingCustomerCount,
          kbSuggestions: kbSuggCount,
          aiActionsAwaitingApproval: aiActionCount,
          accountDeletionRequests: deletionCount,
          approvalRequests: approvalCount,
        },
      };
    }
  );
}
