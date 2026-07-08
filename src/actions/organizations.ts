"use server";

// Z4 — Organization admin surface actions.
//
// * listOrganizationsWithStats — powers /admin/organizations. Batches
//   the users/tickets/tags aggregates in one Support-scoped tx so a
//   dozen orgs doesn't fan out into dozens of wrapper round-trips
//   (same pattern as Z3.1 listCustomers).
// * loadOrganizationDetail — powers /admin/organizations/[id]. Header
//   + users + tickets + tags + custom fields + settings row.
// * updateOrganizationNotes / updateOrganizationSlaPolicy /
//   updateOrganizationBusinessHours — write path for the Support-owned
//   OrganizationSettings sidecar.
// * createOrganizationAction / deleteOrganizationAction — wrapper
//   pass-through, with an admin-only guard and audit.
// * importOrganizationsCsv — bulk create with { succeeded, failed }.

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withRls } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import {
  systemContext,
  listOrganizations,
  getOrganization,
  createOrganization,
  deleteOrganization,
  listTagsForTarget,
  WrapperConflictError,
} from "@/lib/shared-platform";
import { dualFkForUser, actorCols } from "@/lib/z1-dual-fk";
import type { TicketStatus, Priority } from "@/generated/prisma";

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

export type OrganizationRow = {
  id: string;
  name: string;
  domain: string | null;
  userCount: number;
  ticketCount: number;
  openTicketCount: number;
  tags: Array<{ id: string; name: string; color: string }>;
  hasSlaPolicy: boolean;
  createdAt: Date;
};

export async function listOrganizationsWithStats(): Promise<OrganizationRow[]> {
  const session = await requireSession({ minRole: "ADMIN" });
  const ctx = systemContext(session.tenantId);

  const { items: orgs } = await listOrganizations(ctx, { limit: 200 });
  if (orgs.length === 0) return [];
  const ids = orgs.map((o) => o.id);

  const { userCountByOrg, ticketCountByOrg, openTicketCountByOrg, tagsByOrg, settingsByOrg } =
    await withRls(
      { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
      async (tx) => {
        const [primaryUserCounts, secondaryUserCounts, ticketAll, ticketOpen, tagAssignments, settings] =
          await Promise.all([
            // Users whose primary org is this one.
            tx.endUser.groupBy({
              by: ["organizationId"],
              where: { tenantId: session.tenantId, organizationId: { in: ids } },
              _count: { _all: true },
            }),
            // Users attached via secondary EndUserOrganization membership.
            tx.endUserOrganization.groupBy({
              by: ["organizationId"],
              where: { tenantId: session.tenantId, organizationId: { in: ids } },
              _count: { _all: true },
            }),
            tx.ticket.groupBy({
              by: ["organizationId"],
              where: { tenantId: session.tenantId, organizationId: { in: ids } },
              _count: { _all: true },
            }),
            tx.ticket.groupBy({
              by: ["organizationId"],
              where: {
                tenantId: session.tenantId,
                organizationId: { in: ids },
                status: { in: ["OPEN", "IN_PROGRESS", "PENDING"] },
              },
              _count: { _all: true },
            }),
            tx.tagAssignment.findMany({
              where: {
                tenantId: session.tenantId,
                targetType: "ORGANIZATION",
                targetId: { in: ids },
              },
              include: { tag: { select: { id: true, name: true, color: true } } },
            }),
            tx.organizationSettings.findMany({
              where: { tenantId: session.tenantId, organizationId: { in: ids } },
            }),
          ]);

        // Sum primary + secondary. Same user counted once per side per org
        // (secondary attaches are unique by (endUserId, organizationId));
        // a user who's both primary + secondary on the same org would
        // double count, but the schema disallows that combination.
        const userCountByOrg = new Map<string, number>();
        for (const row of primaryUserCounts) {
          if (row.organizationId) userCountByOrg.set(row.organizationId, row._count._all);
        }
        for (const row of secondaryUserCounts) {
          const prev = userCountByOrg.get(row.organizationId) ?? 0;
          userCountByOrg.set(row.organizationId, prev + row._count._all);
        }

        const ticketCountByOrg = new Map<string, number>();
        for (const row of ticketAll) {
          if (row.organizationId) ticketCountByOrg.set(row.organizationId, row._count._all);
        }
        const openTicketCountByOrg = new Map<string, number>();
        for (const row of ticketOpen) {
          if (row.organizationId) openTicketCountByOrg.set(row.organizationId, row._count._all);
        }

        const tagsByOrg = new Map<string, Array<{ id: string; name: string; color: string }>>();
        for (const a of tagAssignments) {
          const prev = tagsByOrg.get(a.targetId) ?? [];
          prev.push({ id: a.tag.id, name: a.tag.name, color: a.tag.color });
          tagsByOrg.set(a.targetId, prev);
        }

        const settingsByOrg = new Map(settings.map((s) => [s.organizationId, s]));

        return { userCountByOrg, ticketCountByOrg, openTicketCountByOrg, tagsByOrg, settingsByOrg };
      }
    );

  return orgs.map<OrganizationRow>((o) => ({
    id: o.id,
    name: o.name,
    domain: o.domain,
    userCount: userCountByOrg.get(o.id) ?? 0,
    ticketCount: ticketCountByOrg.get(o.id) ?? 0,
    openTicketCount: openTicketCountByOrg.get(o.id) ?? 0,
    tags: tagsByOrg.get(o.id) ?? [],
    hasSlaPolicy: Boolean(settingsByOrg.get(o.id)?.slaPolicyId),
    createdAt: o.createdAt,
  }));
}

// ---------------------------------------------------------------------------
// Detail
// ---------------------------------------------------------------------------

export type OrganizationDetail = {
  id: string;
  name: string;
  domain: string | null;
  createdAt: Date;
  notes: string | null;
  slaPolicyId: string | null;
  businessHoursId: string | null;
  tags: Array<{ id: string; name: string; color: string }>;
  users: Array<{
    id: string;
    name: string | null;
    email: string;
    isPrimary: boolean;
    ticketCount: number;
    lastActiveAt: Date | null;
  }>;
  tickets: Array<{
    id: string;
    reference: string;
    title: string;
    status: TicketStatus;
    priority: Priority;
    createdAt: Date;
    updatedAt: Date;
    clientName: string | null;
  }>;
  openTicketCount: number;
};

export async function loadOrganizationDetail(id: string): Promise<OrganizationDetail | null> {
  const session = await requireSession({ minRole: "ADMIN" });
  const ctx = systemContext(session.tenantId);

  const org = await getOrganization(ctx, id);
  if (!org) return null;

  const tags = await listTagsForTarget(ctx, { type: "ORGANIZATION", id });

  const { users, tickets, settings, openTicketCount } = await withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    async (tx) => {
      const [primaryUsers, secondaryMemberships, tickets, settings, openCount] =
        await Promise.all([
          tx.endUser.findMany({
            where: { tenantId: session.tenantId, organizationId: id },
            select: { id: true, name: true, email: true },
          }),
          tx.endUserOrganization.findMany({
            where: { tenantId: session.tenantId, organizationId: id },
            include: {
              endUser: { select: { id: true, name: true, email: true } },
            },
          }),
          tx.ticket.findMany({
            where: { tenantId: session.tenantId, organizationId: id },
            orderBy: { updatedAt: "desc" },
            take: 100,
            select: {
              id: true,
              reference: true,
              title: true,
              status: true,
              priority: true,
              createdAt: true,
              updatedAt: true,
              clientEndUserId: true,
            },
          }),
          tx.organizationSettings.findUnique({ where: { organizationId: id } }),
          tx.ticket.count({
            where: {
              tenantId: session.tenantId,
              organizationId: id,
              status: { in: ["OPEN", "IN_PROGRESS", "PENDING"] },
            },
          }),
        ]);

      // Merge primary + secondary users, tagging which side each came from.
      // Same user can't sit on both (endUsers.organizationId excludes them
      // from the secondary attach), so no dedupe needed.
      const userIds = new Set<string>();
      const merged: Array<{ id: string; name: string | null; email: string; isPrimary: boolean }> = [];
      for (const u of primaryUsers) {
        merged.push({ id: u.id, name: u.name, email: u.email, isPrimary: true });
        userIds.add(u.id);
      }
      for (const m of secondaryMemberships) {
        if (userIds.has(m.endUser.id)) continue;
        merged.push({ id: m.endUser.id, name: m.endUser.name, email: m.endUser.email, isPrimary: false });
        userIds.add(m.endUser.id);
      }

      // Per-user ticket counts + last active — one query each keyed by
      // the merged user id set, avoiding N+1.
      const [ticketPerUser, lifecycles] = await Promise.all([
        userIds.size > 0
          ? tx.ticket.groupBy({
              by: ["clientEndUserId"],
              where: {
                tenantId: session.tenantId,
                clientEndUserId: { in: [...userIds] },
              },
              _count: { _all: true },
            })
          : Promise.resolve([]),
        userIds.size > 0
          ? tx.endUserLifecycle.findMany({
              where: { tenantId: session.tenantId, subjectId: { in: [...userIds] } },
              select: { subjectId: true, lastActiveAt: true },
            })
          : Promise.resolve([]),
      ]);
      const ticketByUser = new Map<string, number>();
      for (const row of ticketPerUser) {
        if (row.clientEndUserId) ticketByUser.set(row.clientEndUserId, row._count._all);
      }
      const lastActiveByUser = new Map(lifecycles.map((l) => [l.subjectId, l.lastActiveAt]));

      // Client display-name lookup for the tickets table — one map join
      // over merged users covers the common case; email-sourced or
      // guest tickets have no clientEndUserId and just show "—".
      const nameById = new Map(merged.map((u) => [u.id, u.name ?? u.email]));

      return {
        users: merged.map((u) => ({
          ...u,
          ticketCount: ticketByUser.get(u.id) ?? 0,
          lastActiveAt: lastActiveByUser.get(u.id) ?? null,
        })),
        tickets: tickets.map((t) => ({
          id: t.id,
          reference: t.reference,
          title: t.title,
          status: t.status,
          priority: t.priority,
          createdAt: t.createdAt,
          updatedAt: t.updatedAt,
          clientName: t.clientEndUserId ? nameById.get(t.clientEndUserId) ?? null : null,
        })),
        settings,
        openTicketCount: openCount,
      };
    }
  );

  return {
    id: org.id,
    name: org.name,
    domain: org.domain,
    createdAt: org.createdAt,
    notes: settings?.notes ?? null,
    slaPolicyId: settings?.slaPolicyId ?? null,
    businessHoursId: settings?.businessHoursId ?? null,
    tags: tags.map((t) => ({ id: t.id, name: t.name, color: t.color })),
    users: users.sort((a, b) => b.ticketCount - a.ticketCount),
    tickets,
    openTicketCount,
  };
}

// ---------------------------------------------------------------------------
// Notes editor
// ---------------------------------------------------------------------------

const notesSchema = z.object({
  organizationId: z.string().min(1),
  notes: z.string().max(4000).nullable(),
});

export async function updateOrganizationNotes(
  input: z.infer<typeof notesSchema>
): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await requireSession({ minRole: "ADMIN" });
  const parsed = notesSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const { organizationId, notes } = parsed.data;

  const ctx = systemContext(session.tenantId);
  const org = await getOrganization(ctx, organizationId);
  if (!org) return { ok: false, error: "Organization not found." };

  await withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    async (tx) => {
      await tx.organizationSettings.upsert({
        where: { organizationId },
        create: { organizationId, tenantId: session.tenantId, notes },
        update: { notes },
      });
      await tx.auditLog.create({
        data: {
          tenantId: session.tenantId,
          ...actorCols(dualFkForUser(session.subjectId, session.role)),
          action: "UPDATE_ORG_NOTES",
          toValue: organizationId,
        },
      });
    }
  );
  revalidatePath(`/admin/organizations/${organizationId}`);
  return { ok: true };
}

// M2.6 — org SLA + business-hours overrides. Written to
// OrganizationSettings so the SLA engine's resolveSlaPolicy /
// resolveBusinessCalendar functions pick them up on the next ticket
// create. Passing null clears the override (falls back to tenant
// default).
const orgOverridesSchema = z.object({
  organizationId: z.string().min(1),
  slaPolicyId: z.string().min(1).nullable(),
  businessHoursId: z.string().min(1).nullable(),
});

export async function updateOrganizationOverrides(input: z.infer<typeof orgOverridesSchema>) {
  const session = await requireSession({ minRole: "ADMIN" });
  const data = orgOverridesSchema.parse(input);
  await withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    async (tx) => {
      // Verify the referenced policy/calendar belong to THIS tenant.
      // RLS on those tables already guarantees it, but a friendlier
      // error message beats a raw FK/permission failure.
      if (data.slaPolicyId) {
        const p = await tx.slaPolicy.findFirst({
          where: { id: data.slaPolicyId, tenantId: session.tenantId },
          select: { id: true },
        });
        if (!p) throw new Error("SLA policy not found in this tenant.");
      }
      if (data.businessHoursId) {
        const c = await tx.businessCalendar.findFirst({
          where: { id: data.businessHoursId, tenantId: session.tenantId },
          select: { id: true },
        });
        if (!c) throw new Error("Business calendar not found in this tenant.");
      }
      await tx.organizationSettings.upsert({
        where: { organizationId: data.organizationId },
        create: {
          organizationId: data.organizationId,
          tenantId: session.tenantId,
          slaPolicyId: data.slaPolicyId,
          businessHoursId: data.businessHoursId,
        },
        update: {
          slaPolicyId: data.slaPolicyId,
          businessHoursId: data.businessHoursId,
        },
      });
      await tx.auditLog.create({
        data: {
          tenantId: session.tenantId,
          ...actorCols(dualFkForUser(session.subjectId, session.role)),
          action: "UPDATE_ORG_OVERRIDES",
          toValue: `sla=${data.slaPolicyId ?? "default"} cal=${data.businessHoursId ?? "default"}`,
        },
      });
    }
  );
  revalidatePath(`/admin/organizations/${data.organizationId}`);
  return { ok: true as const };
}

// ---------------------------------------------------------------------------
// Create + delete
// ---------------------------------------------------------------------------

const createOrgSchema = z.object({
  name: z.string().min(1).max(120),
  domain: z.string().max(200).nullable().optional(),
});

export async function createOrganizationAction(
  input: z.infer<typeof createOrgSchema>
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const session = await requireSession({ minRole: "ADMIN" });
  const parsed = createOrgSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const ctx = systemContext(session.tenantId);
  try {
    const row = await createOrganization(ctx, {
      name: parsed.data.name,
      domain: parsed.data.domain ?? null,
    });
    revalidatePath("/admin/organizations");
    return { ok: true, id: row.id };
  } catch (e) {
    if (e instanceof WrapperConflictError) {
      return { ok: false, error: "An organization with this name already exists." };
    }
    return { ok: false, error: e instanceof Error ? e.message : "Couldn't create." };
  }
}

export async function deleteOrganizationAction(
  organizationId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await requireSession({ minRole: "ADMIN" });
  const ctx = systemContext(session.tenantId);
  const org = await getOrganization(ctx, organizationId);
  if (!org) return { ok: false, error: "Organization not found." };

  try {
    await deleteOrganization(ctx, organizationId);
    // The Support-owned settings row FKs on tenant, not org — nothing
    // cascades. Clean it up explicitly so a re-created org with the same
    // id (impossible for cuid()s but harmless to guard against) doesn't
    // inherit stale notes.
    await withRls(
      { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
      async (tx) => {
        await tx.organizationSettings.deleteMany({ where: { organizationId } });
        await tx.auditLog.create({
          data: {
            tenantId: session.tenantId,
            ...actorCols(dualFkForUser(session.subjectId, session.role)),
            action: "DELETE_ORGANIZATION",
            fromValue: org.name,
          },
        });
      }
    );
    revalidatePath("/admin/organizations");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Couldn't delete." };
  }
}

// ---------------------------------------------------------------------------
// CSV import
// ---------------------------------------------------------------------------

const importSchema = z.object({
  csv: z.string().min(1).max(2_000_000),
});

export type OrganizationImportResult = {
  succeeded: Array<{ name: string; id: string }>;
  failed: Array<{ name: string; reason: string; row: number }>;
};

export async function importOrganizationsCsv(
  input: z.infer<typeof importSchema>
): Promise<OrganizationImportResult | { ok: false; error: string }> {
  const session = await requireSession({ minRole: "ADMIN" });
  const parsed = importSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };

  const rows = parseCsv(parsed.data.csv);
  if (rows.length === 0) return { ok: false, error: "CSV is empty or has no header row." };
  const headers = rows[0].map((h) => h.trim().toLowerCase());
  const nameIdx = headers.indexOf("name");
  if (nameIdx === -1) return { ok: false, error: "CSV must have a 'name' column." };
  const domainIdx = headers.indexOf("domain");

  const ctx = systemContext(session.tenantId);
  const succeeded: OrganizationImportResult["succeeded"] = [];
  const failed: OrganizationImportResult["failed"] = [];

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const displayRow = i + 1;
    const name = (row[nameIdx] ?? "").trim();
    if (name === "") continue;
    const domain = domainIdx >= 0 ? (row[domainIdx] ?? "").trim() || null : null;
    try {
      const created = await createOrganization(ctx, { name, domain });
      succeeded.push({ name, id: created.id });
    } catch (e) {
      if (e instanceof WrapperConflictError) {
        failed.push({ name, reason: "Name already exists in tenant.", row: displayRow });
      } else {
        failed.push({
          name,
          reason: e instanceof Error ? e.message : "Unknown error.",
          row: displayRow,
        });
      }
    }
  }

  revalidatePath("/admin/organizations");
  return { succeeded, failed };
}

// ---------------------------------------------------------------------------
// CSV parser — mirrors src/actions/customersImport.ts's parser.
// ---------------------------------------------------------------------------

function parseCsv(source: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let i = 0;
  let inQuotes = false;
  const s = source;
  while (i < s.length) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false;
        i++;
        continue;
      }
      field += c; i++; continue;
    }
    if (c === '"') { inQuotes = true; i++; continue; }
    if (c === ",") { row.push(field); field = ""; i++; continue; }
    if (c === "\r" || c === "\n") {
      row.push(field); field = "";
      if (c === "\r" && s[i + 1] === "\n") i++;
      i++;
      if (row.some((v) => v !== "")) rows.push(row);
      row = [];
      continue;
    }
    field += c; i++;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    if (row.some((v) => v !== "")) rows.push(row);
  }
  return rows;
}
