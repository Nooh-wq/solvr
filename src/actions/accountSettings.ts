"use server";

// Phase 4b — Account section server actions:
//   - localization (locale/timezone)
//   - custom domains (portal customDomain + verification)
//   - business hours default (defaultBusinessCalendarId)
// Billing is read-only (no plan mutations from the app; upgrades go
// through sales / a future billing provider), so it stays in the
// server component that renders /admin/account/billing.

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withRls } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { actorCols, dualFkForUser } from "@/lib/z1-dual-fk";

// -- Localization -----------------------------------------------------------

const localeRegex = /^[a-z]{2,3}(-[A-Z]{2})?$/;
const timezoneRegex = /^[A-Za-z_]+(\/[A-Za-z_+-]+)*$/;

const localizationSchema = z.object({
  locale: z.string().regex(localeRegex, "Use an IETF locale like en-US or fr-CA."),
  timezone: z.string().regex(timezoneRegex, "Use an IANA timezone like America/New_York."),
});

export async function updateLocalization(
  input: z.infer<typeof localizationSchema>
): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = localizationSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const session = await requireSession({ minRole: "ADMIN" });
  // Sanity: IANA validation via Intl.DateTimeFormat — if the runtime
  // doesn't know the zone, we reject before persisting.
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: parsed.data.timezone });
  } catch {
    return { ok: false, error: "Unknown timezone." };
  }
  try {
    new Intl.DateTimeFormat(parsed.data.locale);
  } catch {
    return { ok: false, error: "Unknown locale." };
  }
  await withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    async (tx) => {
      await tx.tenant.update({
        where: { id: session.tenantId },
        data: { locale: parsed.data.locale, timezone: parsed.data.timezone },
      });
      await tx.auditLog.create({
        data: {
          tenantId: session.tenantId,
          ...actorCols(dualFkForUser(session.subjectId, session.role)),
          action: "LOCALIZATION_UPDATE",
          toValue: `${parsed.data.locale} @ ${parsed.data.timezone}`,
        },
      });
    }
  );
  revalidatePath("/admin/account/localization");
  return { ok: true };
}

// -- Custom domains ---------------------------------------------------------

const domainRegex = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i;

const domainSchema = z.object({
  customDomain: z
    .string()
    .trim()
    .toLowerCase()
    .max(253)
    .refine((v) => v === "" || domainRegex.test(v), "Enter a valid hostname (e.g. support.acme.com)."),
});

export async function updatePortalDomain(
  input: z.infer<typeof domainSchema>
): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = domainSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const session = await requireSession({ minRole: "ADMIN" });
  try {
    await withRls(
      { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
      async (tx) => {
        await tx.tenant.update({
          where: { id: session.tenantId },
          data: { customDomain: parsed.data.customDomain === "" ? null : parsed.data.customDomain },
        });
        await tx.auditLog.create({
          data: {
            tenantId: session.tenantId,
            ...actorCols(dualFkForUser(session.subjectId, session.role)),
            action: parsed.data.customDomain === "" ? "PORTAL_DOMAIN_CLEAR" : "PORTAL_DOMAIN_SET",
            toValue: parsed.data.customDomain || null,
          },
        });
      }
    );
  } catch (e) {
    // P2002 unique — another tenant already claimed this domain.
    if (e instanceof Error && e.message.includes("Unique constraint")) {
      return { ok: false, error: "That domain is already in use." };
    }
    throw e;
  }
  revalidatePath("/admin/account/domains");
  return { ok: true };
}

// -- Business hours default -------------------------------------------------

const bizHoursSchema = z.object({
  defaultBusinessCalendarId: z.string().nullable(),
});

export async function updateDefaultBusinessCalendar(
  input: z.infer<typeof bizHoursSchema>
): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = bizHoursSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input." };
  const session = await requireSession({ minRole: "ADMIN" });

  await withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    async (tx) => {
      if (parsed.data.defaultBusinessCalendarId) {
        const cal = await tx.businessCalendar.findFirst({
          where: { id: parsed.data.defaultBusinessCalendarId, tenantId: session.tenantId },
        });
        if (!cal) throw new Error("Calendar not found.");
      }
      await tx.tenant.update({
        where: { id: session.tenantId },
        data: { defaultBusinessCalendarId: parsed.data.defaultBusinessCalendarId },
      });
      await tx.auditLog.create({
        data: {
          tenantId: session.tenantId,
          ...actorCols(dualFkForUser(session.subjectId, session.role)),
          action: "DEFAULT_BUSINESS_CALENDAR_SET",
          toValue: parsed.data.defaultBusinessCalendarId ?? "(none)",
        },
      });
    }
  );

  revalidatePath("/admin/account/business-hours");
  return { ok: true };
}

// -- Reads ------------------------------------------------------------------

export type AccountSettings = {
  locale: string;
  timezone: string;
  customDomain: string | null;
  defaultBusinessCalendarId: string | null;
  plan: string;
  seatLimit: number | null;
  trialEndsAt: Date | null;
  createdAt: Date;
};

export async function getAccountSettings(): Promise<AccountSettings> {
  const session = await requireSession({ minRole: "ADMIN" });
  const t = await withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    (tx) =>
      tx.tenant.findUniqueOrThrow({
        where: { id: session.tenantId },
        select: {
          locale: true,
          timezone: true,
          customDomain: true,
          defaultBusinessCalendarId: true,
          plan: true,
          seatLimit: true,
          trialEndsAt: true,
          createdAt: true,
        },
      })
  );
  return t;
}

export type BillingUsage = {
  plan: string;
  seatLimit: number | null;
  trialEndsAt: Date | null;
  createdAt: Date;
  teamMemberCount: number;
  activeTeamMemberCount: number;
  endUserCount: number;
  ticketCountLast30Days: number;
  messageCountLast30Days: number;
  apiCallCountLast30Days: number;
};

export async function getBillingUsage(): Promise<BillingUsage> {
  const session = await requireSession({ minRole: "ADMIN" });
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  return withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    async (tx) => {
      const [tenant, teamMemberCount, activeCount, endUserCount, ticketCount, messageCount, apiCount] =
        await Promise.all([
          tx.tenant.findUniqueOrThrow({
            where: { id: session.tenantId },
            select: { plan: true, seatLimit: true, trialEndsAt: true, createdAt: true },
          }),
          tx.teamMember.count({ where: { tenantId: session.tenantId } }),
          tx.teamMemberLifecycle.count({ where: { tenantId: session.tenantId, status: "ACTIVE" } }),
          tx.endUser.count({ where: { tenantId: session.tenantId } }),
          tx.ticket.count({ where: { tenantId: session.tenantId, createdAt: { gte: since } } }),
          tx.message.count({ where: { tenantId: session.tenantId, createdAt: { gte: since } } }),
          tx.apiUsageLog.count({ where: { tenantId: session.tenantId, createdAt: { gte: since } } }),
        ]);
      return {
        plan: tenant.plan,
        seatLimit: tenant.seatLimit,
        trialEndsAt: tenant.trialEndsAt,
        createdAt: tenant.createdAt,
        teamMemberCount,
        activeTeamMemberCount: activeCount,
        endUserCount,
        ticketCountLast30Days: ticketCount,
        messageCountLast30Days: messageCount,
        apiCallCountLast30Days: apiCount,
      };
    }
  );
}
