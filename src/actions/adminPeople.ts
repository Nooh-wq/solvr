"use server";

// Phase 4a — helpers for the People sub-pages (Pending / Suspended /
// Login activity). Read-only aggregations; the mutating actions
// (approveUser, rejectUser, updateUser) already live in admin.ts and
// are called from the UI directly.

import { requireSession } from "@/lib/auth";
import { withRls } from "@/lib/db";
import { Prisma } from "@/generated/prisma";

export type SuspendedRow = {
  id: string;
  name: string;
  email: string;
  role: "CLIENT" | "AGENT" | "ADMIN" | "SUPER_ADMIN" | "LIGHT_AGENT";
  suspendedAt: Date | null;
  lastActiveAt: Date | null;
};

/**
 * Suspended team members + suspended end users, merged. Kept flat so the
 * page just renders a table + a reactivate button that calls updateUser.
 */
export async function listSuspendedUsers(): Promise<SuspendedRow[]> {
  const session = await requireSession({ minRole: "ADMIN" });
  return withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    async (tx) => {
      const [euLc, tmLc] = await Promise.all([
        tx.endUserLifecycle.findMany({
          where: { tenantId: session.tenantId, status: "SUSPENDED" },
          select: { subjectId: true, updatedAt: true, lastActiveAt: true },
        }),
        tx.teamMemberLifecycle.findMany({
          where: { tenantId: session.tenantId, status: "SUSPENDED" },
          select: { subjectId: true, updatedAt: true, lastActiveAt: true },
        }),
      ]);
      const euIds = euLc.map((r) => r.subjectId);
      const tmIds = tmLc.map((r) => r.subjectId);
      const [eus, tms] = await Promise.all([
        euIds.length
          ? tx.endUser.findMany({
              where: { tenantId: session.tenantId, id: { in: euIds } },
              select: { id: true, name: true, email: true },
            })
          : Promise.resolve([]),
        tmIds.length
          ? tx.teamMember.findMany({
              where: { tenantId: session.tenantId, id: { in: tmIds } },
              include: { role: { select: { name: true } } },
            })
          : Promise.resolve([]),
      ]);

      const rows: SuspendedRow[] = [];
      for (const eu of eus) {
        const lc = euLc.find((r) => r.subjectId === eu.id);
        rows.push({
          id: eu.id,
          name: eu.name,
          email: eu.email,
          role: "CLIENT",
          suspendedAt: lc?.updatedAt ?? null,
          lastActiveAt: lc?.lastActiveAt ?? null,
        });
      }
      for (const tm of tms) {
        const lc = tmLc.find((r) => r.subjectId === tm.id);
        const roleName = tm.role.name.toUpperCase().replace(/\s+/g, "_") as SuspendedRow["role"];
        rows.push({
          id: tm.id,
          name: tm.name,
          email: tm.email,
          role: roleName === "SUPPORT_ADMIN" ? "ADMIN" : roleName,
          suspendedAt: lc?.updatedAt ?? null,
          lastActiveAt: lc?.lastActiveAt ?? null,
        });
      }
      rows.sort((a, b) => (b.suspendedAt?.getTime() ?? 0) - (a.suspendedAt?.getTime() ?? 0));
      return rows;
    }
  );
}

export type LoginActivityRow = {
  id: string;
  subjectId: string;
  subjectName: string;
  subjectEmail: string;
  subjectKind: "team_member" | "end_user";
  ipAddress: string | null;
  userAgent: string | null;
  country: string | null;
  createdAt: Date;
};

/**
 * Recent successful logins across the tenant. Joins to TeamMember and
 * EndUser so the UI can show name/email without a client-side loop.
 * Default window is the last 30 days.
 */
export async function listRecentLoginActivity(opts?: {
  days?: number;
  limit?: number;
}): Promise<LoginActivityRow[]> {
  const session = await requireSession({ minRole: "ADMIN" });
  const days = opts?.days ?? 30;
  const limit = Math.min(opts?.limit ?? 200, 500);
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  return withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    async (tx) => {
      const logs = await tx.loginActivity.findMany({
        where: { tenantId: session.tenantId, createdAt: { gte: since } },
        orderBy: { createdAt: "desc" },
        take: limit,
      });
      if (logs.length === 0) return [];

      const teamIds = logs.filter((l) => l.subjectKind === "team_member").map((l) => l.subjectId);
      const endIds = logs.filter((l) => l.subjectKind === "end_user").map((l) => l.subjectId);

      const [teams, ends] = await Promise.all([
        teamIds.length
          ? tx.teamMember.findMany({
              where: { tenantId: session.tenantId, id: { in: teamIds } },
              select: { id: true, name: true, email: true },
            })
          : Promise.resolve([]),
        endIds.length
          ? tx.endUser.findMany({
              where: { tenantId: session.tenantId, id: { in: endIds } },
              select: { id: true, name: true, email: true },
            })
          : Promise.resolve([]),
      ]);
      const teamById = new Map(teams.map((t) => [t.id, t]));
      const endById = new Map(ends.map((e) => [e.id, e]));

      return logs.map((l) => {
        const src = l.subjectKind === "team_member" ? teamById.get(l.subjectId) : endById.get(l.subjectId);
        return {
          id: l.id,
          subjectId: l.subjectId,
          subjectName: src?.name ?? "(removed user)",
          subjectEmail: src?.email ?? "—",
          subjectKind: l.subjectKind as LoginActivityRow["subjectKind"],
          ipAddress: l.ipAddress,
          userAgent: l.userAgent,
          country: l.country,
          createdAt: l.createdAt,
        };
      });
    }
  );
}

// Prisma import kept so the type surface stays stable if we later add
// where-clause helpers (e.g. filter by subjectId) — the runtime unused
// warning is silenced by referencing it here.
void Prisma;
