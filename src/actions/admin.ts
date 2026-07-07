"use server";

import { revalidatePath } from "next/cache";
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { Prisma } from "@/generated/prisma";
import { withRls } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { sendUserInviteEmail, sendRegistrationApprovedEmail, sendRegistrationRejectedEmail } from "@/lib/email/events";
import { contrastRatio } from "@/lib/color";
import { notify } from "@/lib/notifications";
import { uploadImage } from "@/lib/storage";
import { signInviteToken } from "@/lib/session";
import {
  inviteUserSchema,
  updateUserSchema,
  userIdSchema,
  upsertCategorySchema,
  updateBrandingSchema,
  auditLogFilterSchema,
  analyticsFilterSchema,
  bulkUserIdsSchema,
  bulkChangeRoleSchema,
  type AnalyticsFilter,
} from "@/lib/validation/admin";
import { COUNTRIES, countryName } from "@/lib/countries";
import { assertActionAllowed } from "@/lib/team-matrix";
import { matchCompanyByEmail } from "@/lib/company-match";
import {
  dualFkForUser,
  actorCols,
  legacyRoleToWrapperRoleName,
  isLegacyStaffRole,
} from "@/lib/z1-dual-fk";
import {
  systemContext,
  getEndUsersByIds,
  getTeamMembersByIds,
  listEndUsers,
  listTeamMembers,
  getRoleByName,
  createEndUser,
  createTeamMember,
  updateEndUser,
  updateTeamMember,
  deleteEndUser,
  deleteTeamMember,
  WrapperNotFoundError,
} from "@/lib/shared-platform";
import { resolveAuditActor } from "@/lib/z1-view-models";
import type { LegacyRole, Priority, UserStatus } from "@/generated/prisma";

// Z1.5b: single canonical role string, subset of LegacyRole. Every Set B
// consumer already accepts the same widened literal (auth.ts UserRole,
// team-directory role prop). We keep `LegacyRole` as the underlying
// alias so callers importing it type-check unchanged; Z1.5c will collapse
// this back to a bare string literal when the enum is dropped.
type TeamRole = LegacyRole;

// Fixed per-priority first-response targets (analytics: SLA compliance KPI).
// Not a configurable policy engine — see the analytics-v2 plan's explicit
// scope decision to keep this a simple constant rather than a new
// per-tenant SLA-policy data model.
const SLA_THRESHOLD_HOURS: Record<Priority, number> = { URGENT: 1, HIGH: 4, MEDIUM: 8, LOW: 24 };

function generateTempPassword() {
  return crypto.randomBytes(9).toString("base64").replace(/[+/=]/g, "");
}

// Prisma's transaction-client type is exported off the value namespace at
// runtime (Prisma.TransactionClient exists as a type-only property on the
// generated namespace). Aliased here so the helper below can be typed
// without repeating the shape inline.
type Tx = Prisma.TransactionClient;

/**
 * Lockout guard (spec §1.1). Returns true only when `subjectId` IS the last
 * remaining ACTIVE Super Admin on this tenant — i.e. this specific row is
 * a Super Admin, currently ACTIVE, and no other ACTIVE Super Admins exist.
 * Any code changing role/status/deletion of a user must consult this to
 * avoid leaving the tenant with no one able to manage roles.
 *
 * Z1.5b: sources shifted to wrapper Role + TeamMemberLifecycle. A CLIENT
 * is trivially not a Super Admin — short-circuit false. Otherwise resolve
 * the tenant's Super Admin wrapper role id, then count TeamMembers with
 * that role whose lifecycle row is ACTIVE.
 */
async function isLastSuperAdmin(
  tx: Tx,
  subjectId: string,
  tenantId: string,
  role: TeamRole,
  status: UserStatus
): Promise<boolean> {
  if (role !== "SUPER_ADMIN" || status !== "ACTIVE") return false;
  const superAdminRole = await tx.role.findFirst({
    where: { tenantId, name: "Super Admin" },
    select: { id: true },
  });
  if (!superAdminRole) return false;
  const superAdmins = await tx.teamMember.findMany({
    where: { tenantId, roleId: superAdminRole.id },
    select: { id: true },
  });
  if (superAdmins.length === 0) return false;
  const activeCount = await tx.teamMemberLifecycle.count({
    where: {
      tenantId,
      status: "ACTIVE",
      subjectId: { in: superAdmins.map((s) => s.id) },
    },
  });
  // If we're the only one, activeCount is 1 — deactivating/demoting/deleting
  // us drops it to 0. Any count > 1 is safe. Guard target must be in the
  // set for the check to be meaningful.
  const targetIsSuperAdmin = superAdmins.some((s) => s.id === subjectId);
  return targetIsSuperAdmin && activeCount <= 1;
}

// ---------------------------------------------------------------------------
// Set B loaders — a "team row" is the merged view of one subject (EndUser
// or TeamMember) with its lifecycle + org + role. Replaces every previous
// tx.user.* read. Kept here rather than in a helper file because it's
// admin.ts-scoped: only the /admin/team surface consumes this shape.
// ---------------------------------------------------------------------------

/**
 * Unified team-row shape returned by loadTeamRow / loadTeamRows. Field
 * names match the previous TEAM_ROW_SELECT so /admin/team's page.tsx
 * consumes it without change. `avatarUrl` is intentionally always null:
 * Z1.7 will thread it back through the wrapper (boundary doc §7.10).
 * `company` (legacy free-text) is always null since it was dropped from
 * the wrapper — `companyRef.name` is the sole company source now.
 */
export type TeamRow = {
  id: string;
  name: string | null;
  email: string;
  role: TeamRole;
  status: UserStatus;
  company: string | null;
  companyRef: { id: string; name: string } | null;
  lastActiveAt: Date | null;
  invitedAt: Date | null;
  invitedById: string | null;
  approvedAt: Date | null;
  approvedById: string | null;
  rejectedAt: Date | null;
  rejectedById: string | null;
  avatarUrl: string | null;
  createdAt: Date;
};

const SUPER_ADMIN_ROLE_NAME = "Super Admin";
const ADMIN_ROLE_NAME = "Admin";
const AGENT_ROLE_NAME = "Agent";

/** Wrapper Role.name → LegacyRole enum. Unknown roles fall to "AGENT" (safest tier). */
function wrapperRoleNameToTeamRole(name: string): TeamRole {
  if (name === SUPER_ADMIN_ROLE_NAME) return "SUPER_ADMIN";
  if (name === ADMIN_ROLE_NAME) return "ADMIN";
  if (name === AGENT_ROLE_NAME) return "AGENT";
  return "AGENT";
}

/** LegacyRole enum → wrapper Role.name for staff roles. Throws on CLIENT (not a wrapper role). */
function teamRoleToWrapperRoleName(role: TeamRole): string {
  if (role === "SUPER_ADMIN") return SUPER_ADMIN_ROLE_NAME;
  if (role === "ADMIN") return ADMIN_ROLE_NAME;
  if (role === "AGENT") return AGENT_ROLE_NAME;
  throw new Error(`CLIENT is not a wrapper staff role`);
}

/**
 * Loads one team row by subject id. Returns null if the id doesn't match
 * an EndUser OR a TeamMember on this tenant. Two wrapper reads + one
 * lifecycle read + optional Organization read.
 */
async function loadTeamRow(tx: Tx, tenantId: string, subjectId: string): Promise<TeamRow | null> {
  const [endUser, teamMember] = await Promise.all([
    tx.endUser.findFirst({
      where: { id: subjectId, tenantId },
    }),
    tx.teamMember.findFirst({
      where: { id: subjectId, tenantId },
      include: { role: { select: { name: true } } },
    }),
  ]);
  if (!endUser && !teamMember) return null;

  const [endUserLifecycle, teamMemberLifecycle, org] = await Promise.all([
    endUser ? tx.endUserLifecycle.findUnique({ where: { subjectId } }) : Promise.resolve(null),
    teamMember ? tx.teamMemberLifecycle.findUnique({ where: { subjectId } }) : Promise.resolve(null),
    endUser?.organizationId
      ? tx.organization.findFirst({
          where: { id: endUser.organizationId, tenantId },
          select: { id: true, name: true },
        })
      : Promise.resolve(null),
  ]);

  if (endUser) {
    const lc = endUserLifecycle;
    return {
      id: endUser.id,
      name: endUser.name,
      email: endUser.email,
      role: "CLIENT",
      status: lc?.status ?? "PENDING",
      company: null,
      companyRef: org ? { id: org.id, name: org.name } : null,
      lastActiveAt: lc?.lastActiveAt ?? null,
      invitedAt: lc?.invitedAt ?? null,
      invitedById: lc?.invitedById ?? null,
      approvedAt: lc?.approvedAt ?? null,
      approvedById: lc?.approvedById ?? null,
      rejectedAt: lc?.rejectedAt ?? null,
      rejectedById: lc?.rejectedById ?? null,
      avatarUrl: null,
      createdAt: endUser.createdAt,
    };
  }
  const tm = teamMember!;
  const lc = teamMemberLifecycle;
  return {
    id: tm.id,
    name: tm.name,
    email: tm.email,
    role: wrapperRoleNameToTeamRole(tm.role.name),
    status: lc?.status ?? "PENDING",
    company: null,
    companyRef: null,
    lastActiveAt: lc?.lastActiveAt ?? null,
    invitedAt: lc?.invitedAt ?? null,
    invitedById: lc?.invitedById ?? null,
    approvedAt: lc?.approvedAt ?? null,
    approvedById: lc?.approvedById ?? null,
    rejectedAt: lc?.rejectedAt ?? null,
    rejectedById: lc?.rejectedById ?? null,
    avatarUrl: null,
    createdAt: tm.createdAt,
  };
}

/**
 * Loads all team rows for a tenant. Optional status filter applies to the
 * merged rows (a subject with no lifecycle row defaults to PENDING). Sorted
 * by createdAt asc — same order the previous tx.user.findMany used.
 */
async function loadTeamRows(
  tx: Tx,
  tenantId: string,
  opts: { statusIn?: UserStatus[] } = {}
): Promise<TeamRow[]> {
  const [endUsers, teamMembers, endUserLcs, teamMemberLcs] = await Promise.all([
    tx.endUser.findMany({ where: { tenantId } }),
    tx.teamMember.findMany({
      where: { tenantId },
      include: { role: { select: { name: true } } },
    }),
    tx.endUserLifecycle.findMany({ where: { tenantId } }),
    tx.teamMemberLifecycle.findMany({ where: { tenantId } }),
  ]);

  const endUserLcById = new Map(endUserLcs.map((l) => [l.subjectId, l]));
  const teamMemberLcById = new Map(teamMemberLcs.map((l) => [l.subjectId, l]));

  const orgIds = Array.from(
    new Set(endUsers.map((eu) => eu.organizationId).filter((id): id is string => !!id))
  );
  const orgs =
    orgIds.length > 0
      ? await tx.organization.findMany({
          where: { id: { in: orgIds }, tenantId },
          select: { id: true, name: true },
        })
      : [];
  const orgById = new Map(orgs.map((o) => [o.id, o]));

  const rows: TeamRow[] = [];

  for (const eu of endUsers) {
    const lc = endUserLcById.get(eu.id);
    const status = lc?.status ?? ("PENDING" as UserStatus);
    if (opts.statusIn && !opts.statusIn.includes(status)) continue;
    const org = eu.organizationId ? orgById.get(eu.organizationId) : undefined;
    rows.push({
      id: eu.id,
      name: eu.name,
      email: eu.email,
      role: "CLIENT",
      status,
      company: null,
      companyRef: org ? { id: org.id, name: org.name } : null,
      lastActiveAt: lc?.lastActiveAt ?? null,
      invitedAt: lc?.invitedAt ?? null,
      invitedById: lc?.invitedById ?? null,
      approvedAt: lc?.approvedAt ?? null,
      approvedById: lc?.approvedById ?? null,
      rejectedAt: lc?.rejectedAt ?? null,
      rejectedById: lc?.rejectedById ?? null,
      avatarUrl: null,
      createdAt: eu.createdAt,
    });
  }

  for (const tm of teamMembers) {
    const lc = teamMemberLcById.get(tm.id);
    const status = lc?.status ?? ("PENDING" as UserStatus);
    if (opts.statusIn && !opts.statusIn.includes(status)) continue;
    rows.push({
      id: tm.id,
      name: tm.name,
      email: tm.email,
      role: wrapperRoleNameToTeamRole(tm.role.name),
      status,
      company: null,
      companyRef: null,
      lastActiveAt: lc?.lastActiveAt ?? null,
      invitedAt: lc?.invitedAt ?? null,
      invitedById: lc?.invitedById ?? null,
      approvedAt: lc?.approvedAt ?? null,
      approvedById: lc?.approvedById ?? null,
      rejectedAt: lc?.rejectedAt ?? null,
      rejectedById: lc?.rejectedById ?? null,
      avatarUrl: null,
      createdAt: tm.createdAt,
    });
  }

  return rows.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
}

// ---------------------------------------------------------------------------
// Team & roles
// ---------------------------------------------------------------------------

// Z1.5b: reads are wrapper + lifecycle only. Identity (name/email/role)
// comes from EndUser / TeamMember + wrapper Role, status/timestamps
// from EndUserLifecycle / TeamMemberLifecycle, org from wrapper
// Organization. See docs/shared-platform-boundary.md §7.11.
export async function listTeam() {
  const session = await requireSession({ minRole: "ADMIN" });
  return withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    (tx) => loadTeamRows(tx, session.tenantId)
  );
}

export async function listPendingUsers() {
  const session = await requireSession({ minRole: "ADMIN" });
  return withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    (tx) => loadTeamRows(tx, session.tenantId, { statusIn: ["PENDING"] })
  );
}

type InviteUserResult = { ok: true } | { ok: false; error: string };

/**
 * Admin creates a user directly with status INVITED — a placeholder password
 * hash goes in (random, never emailed, unusable) since the column can't be
 * null, but nobody can actually log in with it: login() rejects INVITED
 * accounts outright. Instead this emails an accept-invite link; the user
 * sets their own password there and verifies a one-time emailed code before
 * their first session is ever created (see acceptInvite()/verifyLoginOtp()
 * in actions/auth.ts). Admin-invited users skip the registration approval
 * gate — the admin creating them *is* the approval.
 */
export async function inviteUser(input: z.infer<typeof inviteUserSchema>): Promise<InviteUserResult> {
  const session = await requireSession({ minRole: "ADMIN" });

  // safeParse: preserve specific validation errors through the Server Action
  // boundary (throwing gets the message redacted by Next.js in production).
  const parsed = inviteUserSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const data = parsed.data;

  const placeholderHash = await bcrypt.hash(generateTempPassword(), 10);
  const organizationId = await matchCompanyByEmail(session.tenantId, data.email);
  const ctx = systemContext(session.tenantId);
  const subjectId = crypto.randomUUID();

  // Pre-tx uniqueness check across both stores under SUPER_ADMIN scope so
  // we can return a clean {ok:false, error} instead of P2002 exceptions.
  const exists = await withRls(
    { tenantId: session.tenantId, userId: null, role: "SUPER_ADMIN" },
    async (tx) => {
      const [eu, tm] = await Promise.all([
        tx.endUser.findFirst({ where: { tenantId: session.tenantId, email: data.email } }),
        tx.teamMember.findFirst({ where: { tenantId: session.tenantId, email: data.email } }),
      ]);
      return Boolean(eu || tm);
    }
  );
  if (exists) return { ok: false, error: "An account with this email already exists." };

  // Wrapper counterpart first (fails cleanly if e.g. wrapper role missing).
  // Cross-boundary correctness: wrapper create happens outside the Support
  // withRls so the wrapper's own tenant-scoped tx isn't nested.
  if (data.role === "CLIENT") {
    await createEndUser(ctx, {
      id: subjectId,
      email: data.email,
      name: data.name,
      organizationId,
    });
  } else {
    const wrapperRole = await getRoleByName(ctx, teamRoleToWrapperRoleName(data.role));
    if (!wrapperRole) {
      return {
        ok: false,
        error: `Wrapper role "${teamRoleToWrapperRoleName(data.role)}" is not seeded on this tenant.`,
      };
    }
    await createTeamMember(ctx, {
      id: subjectId,
      email: data.email,
      name: data.name,
      roleId: wrapperRole.id,
    });
  }

  // Lifecycle + credentials + audit — Support-owned tables, one tx.
  const branding = await withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    async (tx) => {
      const lifecycleData = {
        tenantId: session.tenantId,
        status: "INVITED" as const,
        invitedAt: new Date(),
        invitedById: session.subjectId,
      };
      if (data.role === "CLIENT") {
        await tx.endUserLifecycle.upsert({
          where: { subjectId },
          create: { subjectId, ...lifecycleData },
          update: lifecycleData,
        });
      } else {
        await tx.teamMemberLifecycle.upsert({
          where: { subjectId },
          create: { subjectId, ...lifecycleData },
          update: lifecycleData,
        });
      }
      await tx.authCredential.create({
        data: {
          tenantId: session.tenantId,
          subjectEndUserId: data.role === "CLIENT" ? subjectId : null,
          subjectTeamMemberId: data.role === "CLIENT" ? null : subjectId,
          passwordHash: placeholderHash,
        },
      });
      await tx.auditLog.create({
        data: {
          tenantId: session.tenantId,
          actorId: session.subjectId,
          ...actorCols(dualFkForUser(session.subjectId, session.role)),
          action: "INVITE_USER",
          toValue: data.email,
        },
      });
      return tx.tenantBranding.findUnique({ where: { tenantId: session.tenantId } });
    }
  );

  const inviteToken = await signInviteToken({ userId: subjectId, tenantId: session.tenantId });
  const acceptUrl = `${process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"}/auth/invite/accept?token=${encodeURIComponent(inviteToken)}`;
  await sendUserInviteEmail(data.email, acceptUrl, branding);

  revalidatePath("/admin/team");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Z1.6 dual-write helpers. Fire AFTER the legacy withRls commits, not
// inside it — see the comment on inviteUser's call site for the
// drift-safety rationale. All wrapper calls open their own tenant-scoped
// RLS transactions internally.
// ---------------------------------------------------------------------------

async function createWrapperCounterpart(input: {
  tenantId: string;
  id: string;
  email: string;
  name: string | null;
  role: LegacyRole;
  organizationId: string | null;
}): Promise<void> {
  const ctx = systemContext(input.tenantId);
  if (input.role === "CLIENT") {
    await createEndUser(ctx, {
      id: input.id,
      email: input.email,
      name: input.name,
      organizationId: input.organizationId,
    });
    return;
  }
  if (isLegacyStaffRole(input.role)) {
    const wrapperRole = await getRoleByName(ctx, legacyRoleToWrapperRoleName(input.role));
    if (!wrapperRole) {
      // Z1.3 seeded the three standard roles on every tenant — this
      // "should never happen" case surfaces as a diagnostic. Rather
      // than throw and rollback the legacy invite (which already
      // committed), record a diagnostic. Drift-check script picks it
      // up on the next run.
      console.error(`[Z1.6] Wrapper role "${legacyRoleToWrapperRoleName(input.role)}" not seeded on tenant ${input.tenantId}; skipping createTeamMember for ${input.id}`);
      return;
    }
    await createTeamMember(ctx, {
      id: input.id,
      email: input.email,
      name: input.name,
      roleId: wrapperRole.id,
    });
  }
}

async function deleteWrapperCounterpart(tenantId: string, id: string, role: LegacyRole): Promise<void> {
  const ctx = systemContext(tenantId);
  try {
    if (role === "CLIENT") await deleteEndUser(ctx, id);
    else if (isLegacyStaffRole(role)) await deleteTeamMember(ctx, id);
  } catch (e) {
    if (e instanceof WrapperNotFoundError) {
      // Wrapper counterpart already missing — legacy delete succeeded
      // and there's nothing left to remove. Drift-safe.
      return;
    }
    throw e;
  }
}

async function updateWrapperCounterpartRole(
  tenantId: string,
  id: string,
  fromRole: LegacyRole,
  toRole: LegacyRole
): Promise<void> {
  // Cross-boundary role changes (CLIENT ↔ staff) require deleting the
  // wrapper row of one kind and creating the other. That destroys
  // organizationId (on EndUser → TeamMember) or ticketAccessScope (on
  // TeamMember → EndUser). Rather than silently drop data, Z1.6 blocks
  // this transition — admin must delete + reinvite explicitly. Legacy
  // code accepted the transition but silently drifted the wrapper; the
  // explicit throw is a correctness improvement.
  const fromIsClient = fromRole === "CLIENT";
  const toIsClient = toRole === "CLIENT";
  if (fromIsClient !== toIsClient) {
    throw new Error(
      "Cross-boundary role change (CLIENT ↔ staff) not supported. Delete this user and reinvite with the new role."
    );
  }
  if (fromIsClient) return; // CLIENT → CLIENT is a no-op at this layer
  if (!isLegacyStaffRole(toRole)) return;
  const ctx = systemContext(tenantId);
  const wrapperRole = await getRoleByName(ctx, legacyRoleToWrapperRoleName(toRole));
  if (!wrapperRole) {
    console.error(`[Z1.6] Wrapper role "${legacyRoleToWrapperRoleName(toRole)}" not seeded on tenant ${tenantId}; skipping updateTeamMember for ${id}`);
    return;
  }
  try {
    await updateTeamMember(ctx, id, { roleId: wrapperRole.id });
  } catch (e) {
    if (e instanceof WrapperNotFoundError) {
      // Wrapper counterpart missing — legacy update succeeded, drift
      // exists. Log and let drift-check surface.
      console.error(`[Z1.6] TeamMember ${id} missing on wrapper during role update; drift-check will report`);
      return;
    }
    throw e;
  }
}

export async function updateUser(input: z.infer<typeof updateUserSchema>) {
  const session = await requireSession({ minRole: "ADMIN" });
  const data = updateUserSchema.parse(input);

  const { target, roleChanged, statusChanged } = await withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    async (tx) => {
      const target = await loadTeamRow(tx, session.tenantId, data.userId);
      if (!target) throw new Error("NOT_FOUND");
      if (target.id === session.subjectId && data.role && data.role !== target.role) {
        throw new Error("Cannot change your own role.");
      }

      // Last-Super-Admin lockout guard (spec §1.1). See isLastSuperAdmin
      // above — resolves against wrapper Role + TeamMemberLifecycle now.
      const isTargetLastSuperAdmin = await isLastSuperAdmin(
        tx,
        target.id,
        session.tenantId,
        target.role,
        target.status
      );
      const isRoleChange = data.role !== undefined && data.role !== target.role;
      const isDeactivate = data.status === "SUSPENDED";
      const isReactivate = data.status === "ACTIVE";

      if (isRoleChange) {
        assertActionAllowed("changeRole", target.status, { isLastSuperAdmin: isTargetLastSuperAdmin });
      }
      if (isDeactivate) {
        assertActionAllowed("deactivate", target.status, { isLastSuperAdmin: isTargetLastSuperAdmin });
      }
      if (isReactivate) {
        assertActionAllowed("reactivate", target.status, { isLastSuperAdmin: false });
      }

      const statusChanged = data.status !== undefined && data.status !== target.status;

      if (statusChanged) {
        const lifecyclePatch = { status: data.status! };
        if (target.role === "CLIENT") {
          await tx.endUserLifecycle.upsert({
            where: { subjectId: target.id },
            create: { subjectId: target.id, tenantId: session.tenantId, ...lifecyclePatch },
            update: lifecyclePatch,
          });
        } else {
          await tx.teamMemberLifecycle.upsert({
            where: { subjectId: target.id },
            create: { subjectId: target.id, tenantId: session.tenantId, ...lifecyclePatch },
            update: lifecyclePatch,
          });
        }
      }

      if (isRoleChange) {
        await tx.auditLog.create({
          data: {
            tenantId: session.tenantId,
            actorId: session.subjectId,
            ...actorCols(dualFkForUser(session.subjectId, session.role)),
            action: "ROLE_CHANGE",
            fromValue: target.role,
            toValue: data.role!,
          },
        });
      }
      if (statusChanged) {
        await tx.auditLog.create({
          data: {
            tenantId: session.tenantId,
            actorId: session.subjectId,
            ...actorCols(dualFkForUser(session.subjectId, session.role)),
            action: data.status === "ACTIVE" ? "REACTIVATE_USER" : "DEACTIVATE_USER",
            toValue: target.email,
          },
        });
      }

      return { target, roleChanged: isRoleChange, statusChanged };
    }
  );

  // Role changes propagate to the wrapper TeamMember. Cross-boundary role
  // changes (CLIENT ↔ staff) throw explicitly — see
  // updateWrapperCounterpartRole. Fires after the Support-side tx commits
  // so wrapper failure doesn't roll back the lifecycle/audit rows.
  if (roleChanged && data.role) {
    await updateWrapperCounterpartRole(session.tenantId, target.id, target.role, data.role);
  }

  const nextStatus = statusChanged ? data.status! : target.status;
  const nextRole = roleChanged ? data.role! : target.role;

  revalidatePath("/admin/team");
  return {
    ok: true,
    user: { id: target.id, email: target.email, role: nextRole, status: nextStatus },
  };
}

/**
 * Permanently removes a user. Wrapper FKs on tickets (clientEndUserId /
 * assignedTeamMemberId) enforce the same "no orphan history" invariant
 * the legacy schema did — a P2003 surfaces as the same friendly message.
 * Fires: Support-side audit + lifecycle delete → wrapper counterpart
 * delete. Order matters: wrapper delete after Support-side commit so a
 * P2003 from the wrapper doesn't half-delete the Support rows.
 */
export async function deleteUser(input: z.infer<typeof userIdSchema>): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await requireSession({ minRole: "ADMIN" });
  const data = userIdSchema.parse(input);
  if (data.userId === session.subjectId) return { ok: false, error: "You can't delete your own account." };

  const outcome = await withRls({ tenantId: session.tenantId, userId: session.subjectId, role: session.role }, async (tx) => {
    const target = await loadTeamRow(tx, session.tenantId, data.userId);
    if (!target) return { ok: false as const, error: "User not found." };

    if (await isLastSuperAdmin(tx, target.id, session.tenantId, target.role, target.status)) {
      return { ok: false as const, error: "Can't delete the last Super Admin on this tenant. Promote another Admin first." };
    }

    await tx.auditLog.create({
      data: {
        tenantId: session.tenantId,
        actorId: session.subjectId,
        ...actorCols(dualFkForUser(session.subjectId, session.role)),
        action: "DELETE_USER",
        toValue: target.email,
      },
    });
    // Credentials + lifecycle are Support-owned; wipe both before the
    // wrapper delete so a wrapper failure leaves the subject in a clean
    // "orphaned-wrapper" state (drift-check can heal it), never a
    // "credentials exist for a deleted wrapper subject" state.
    await tx.authCredential.deleteMany({
      where: {
        tenantId: session.tenantId,
        OR: [{ subjectEndUserId: target.id }, { subjectTeamMemberId: target.id }],
      },
    });
    if (target.role === "CLIENT") {
      await tx.endUserLifecycle.deleteMany({ where: { subjectId: target.id } });
    } else {
      await tx.teamMemberLifecycle.deleteMany({ where: { subjectId: target.id } });
    }

    return { ok: true as const, deletedId: target.id, deletedRole: target.role };
  });

  if (!outcome.ok) return outcome;

  try {
    await deleteWrapperCounterpart(session.tenantId, outcome.deletedId, outcome.deletedRole);
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2003") {
      return { ok: false, error: "Can't delete — this person still has tickets on record. Deactivate them instead." };
    }
    throw e;
  }

  revalidatePath("/admin/team");
  return { ok: true as const };
}

/** Approves a PENDING registration (email flow design §"Registration Approval Gate"). */
export async function approveUser(input: z.infer<typeof userIdSchema>) {
  const session = await requireSession({ minRole: "ADMIN" });
  const data = userIdSchema.parse(input);

  const { targetEmail, branding } = await withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    async (tx) => {
      const target = await loadTeamRow(tx, session.tenantId, data.userId);
      if (!target) throw new Error("NOT_FOUND");
      assertActionAllowed("approve", target.status, { isLastSuperAdmin: false });

      const patch = {
        status: "ACTIVE" as const,
        approvedAt: new Date(),
        approvedById: session.subjectId,
      };
      if (target.role === "CLIENT") {
        await tx.endUserLifecycle.upsert({
          where: { subjectId: target.id },
          create: { subjectId: target.id, tenantId: session.tenantId, ...patch },
          update: patch,
        });
      } else {
        await tx.teamMemberLifecycle.upsert({
          where: { subjectId: target.id },
          create: { subjectId: target.id, tenantId: session.tenantId, ...patch },
          update: patch,
        });
      }
      await tx.auditLog.create({
        data: {
          tenantId: session.tenantId,
          actorId: session.subjectId,
          ...actorCols(dualFkForUser(session.subjectId, session.role)),
          action: "APPROVE_USER",
          toValue: target.email,
        },
      });
      await notify(tx, {
        tenantId: session.tenantId,
        userId: target.id,
        type: "REGISTRATION_APPROVED",
        title: "Your account was approved",
        body: "You can now log in.",
      });
      const branding = await tx.tenantBranding.findUnique({ where: { tenantId: session.tenantId } });
      return { targetEmail: target.email, branding };
    }
  );

  await sendRegistrationApprovedEmail(targetEmail, branding);

  revalidatePath("/admin/team");
  return { ok: true };
}

/** Rejects a PENDING registration. */
export async function rejectUser(input: z.infer<typeof userIdSchema>) {
  const session = await requireSession({ minRole: "ADMIN" });
  const data = userIdSchema.parse(input);

  const { targetEmail, branding } = await withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    async (tx) => {
      const target = await loadTeamRow(tx, session.tenantId, data.userId);
      if (!target) throw new Error("NOT_FOUND");
      assertActionAllowed("reject", target.status, { isLastSuperAdmin: false });

      const patch = {
        status: "REJECTED" as const,
        rejectedAt: new Date(),
        rejectedById: session.subjectId,
      };
      if (target.role === "CLIENT") {
        await tx.endUserLifecycle.upsert({
          where: { subjectId: target.id },
          create: { subjectId: target.id, tenantId: session.tenantId, ...patch },
          update: patch,
        });
      } else {
        await tx.teamMemberLifecycle.upsert({
          where: { subjectId: target.id },
          create: { subjectId: target.id, tenantId: session.tenantId, ...patch },
          update: patch,
        });
      }
      await tx.auditLog.create({
        data: {
          tenantId: session.tenantId,
          actorId: session.subjectId,
          ...actorCols(dualFkForUser(session.subjectId, session.role)),
          action: "REJECT_USER",
          toValue: target.email,
        },
      });
      const branding = await tx.tenantBranding.findUnique({ where: { tenantId: session.tenantId } });
      return { targetEmail: target.email, branding };
    }
  );

  await sendRegistrationRejectedEmail(targetEmail, branding);

  revalidatePath("/admin/team");
  return { ok: true };
}

/**
 * Regenerates a fresh HMAC invite token and re-sends the accept-invite
 * email. Only valid for INVITED accounts (spec §4 / §3 matrix). The old
 * token stays valid until its own expiry — signInviteToken is stateless,
 * so we can't invalidate a specific past JWT; both work until they expire.
 * That's fine: the invite URL only lets the recipient set their own
 * password + verify OTP, and this endpoint requires no prior state on the
 * recipient's side.
 */
export async function resendInvite(input: z.infer<typeof userIdSchema>): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await requireSession({ minRole: "ADMIN" });
  const data = userIdSchema.parse(input);

  const { targetId, targetEmail, branding } = await withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    async (tx) => {
      const target = await loadTeamRow(tx, session.tenantId, data.userId);
      if (!target) throw new Error("NOT_FOUND");
      assertActionAllowed("resendInvite", target.status, { isLastSuperAdmin: false });

      await tx.auditLog.create({
        data: {
          tenantId: session.tenantId,
          actorId: session.subjectId,
          ...actorCols(dualFkForUser(session.subjectId, session.role)),
          action: "INVITE_RESENT",
          toValue: target.email,
        },
      });
      const branding = await tx.tenantBranding.findUnique({ where: { tenantId: session.tenantId } });
      return { targetId: target.id, targetEmail: target.email, branding };
    }
  );

  const inviteToken = await signInviteToken({ userId: targetId, tenantId: session.tenantId });
  const acceptUrl = `${process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"}/auth/invite/accept?token=${encodeURIComponent(inviteToken)}`;
  await sendUserInviteEmail(targetEmail, acceptUrl, branding);

  revalidatePath("/admin/team");
  return { ok: true };
}

/**
 * Cancels an outstanding invite. Deletes the User row entirely — INVITED
 * accounts have never logged in, own no tickets/messages, and have no FK
 * dependents beyond the invite-related audit log entries (which reference
 * the acting admin, not the invited user, so they survive the delete).
 * Freeing the email row lets the admin re-invite the same address later
 * without hitting the unique-per-tenant email constraint.
 */
export async function revokeInvite(input: z.infer<typeof userIdSchema>): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await requireSession({ minRole: "ADMIN" });
  const data = userIdSchema.parse(input);

  const outcome = await withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    async (tx) => {
      const target = await loadTeamRow(tx, session.tenantId, data.userId);
      if (!target) return { ok: false as const, error: "User not found." };
      assertActionAllowed("revokeInvite", target.status, { isLastSuperAdmin: false });

      await tx.auditLog.create({
        data: {
          tenantId: session.tenantId,
          actorId: session.subjectId,
          ...actorCols(dualFkForUser(session.subjectId, session.role)),
          action: "INVITE_REVOKED",
          toValue: target.email,
        },
      });
      await tx.authCredential.deleteMany({
        where: {
          tenantId: session.tenantId,
          OR: [{ subjectEndUserId: target.id }, { subjectTeamMemberId: target.id }],
        },
      });
      if (target.role === "CLIENT") {
        await tx.endUserLifecycle.deleteMany({ where: { subjectId: target.id } });
      } else {
        await tx.teamMemberLifecycle.deleteMany({ where: { subjectId: target.id } });
      }

      return { ok: true as const, deletedId: target.id, deletedRole: target.role };
    }
  );

  if (!outcome.ok) return outcome;

  await deleteWrapperCounterpart(session.tenantId, outcome.deletedId, outcome.deletedRole);

  revalidatePath("/admin/team");
  return { ok: true };
}

/**
 * Undoes a rejection and starts a fresh invite flow for the same email.
 * The row transitions REJECTED → INVITED, the accept-invite email is sent
 * with a new HMAC token, and the rejectedAt/rejectedBy audit-log entry
 * stays as the historical record of what happened before this re-invite.
 * This is deliberately a distinct action from resendInvite (spec §3
 * matrix): re-inviting a rejected user is a conscious "we changed our
 * mind" decision, not just resending a mis-typed email.
 */
export async function reinviteUser(input: z.infer<typeof userIdSchema>): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await requireSession({ minRole: "ADMIN" });
  const data = userIdSchema.parse(input);

  const { targetId, targetEmail, branding } = await withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    async (tx) => {
      const target = await loadTeamRow(tx, session.tenantId, data.userId);
      if (!target) throw new Error("NOT_FOUND");
      assertActionAllowed("reinvite", target.status, { isLastSuperAdmin: false });

      const patch = { status: "INVITED" as const };
      if (target.role === "CLIENT") {
        await tx.endUserLifecycle.upsert({
          where: { subjectId: target.id },
          create: { subjectId: target.id, tenantId: session.tenantId, ...patch },
          update: patch,
        });
      } else {
        await tx.teamMemberLifecycle.upsert({
          where: { subjectId: target.id },
          create: { subjectId: target.id, tenantId: session.tenantId, ...patch },
          update: patch,
        });
      }
      await tx.auditLog.create({
        data: {
          tenantId: session.tenantId,
          actorId: session.subjectId,
          ...actorCols(dualFkForUser(session.subjectId, session.role)),
          action: "REINVITE_USER",
          toValue: target.email,
        },
      });
      const branding = await tx.tenantBranding.findUnique({ where: { tenantId: session.tenantId } });
      return { targetId: target.id, targetEmail: target.email, branding };
    }
  );

  const inviteToken = await signInviteToken({ userId: targetId, tenantId: session.tenantId });
  const acceptUrl = `${process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"}/auth/invite/accept?token=${encodeURIComponent(inviteToken)}`;
  await sendUserInviteEmail(targetEmail, acceptUrl, branding);

  revalidatePath("/admin/team");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Bulk actions (spec §4). Each per-user check runs inside the same
// transaction as the mutation so the row's status/last-super-admin state
// can't drift between guard and write. Failures are collected into a
// per-user list rather than short-circuiting — an "8 of 9 succeeded, 1
// skipped (last Super Admin)" result is more useful than a silent revert.
// ---------------------------------------------------------------------------

export type BulkActionResult = {
  succeeded: string[];
  failed: { userId: string; reason: string }[];
};

export async function bulkChangeRole(input: z.infer<typeof bulkChangeRoleSchema>): Promise<BulkActionResult> {
  const session = await requireSession({ minRole: "ADMIN" });
  const data = bulkChangeRoleSchema.parse(input);

  const { result, wrapperUpdates } = await withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    async (tx) => {
      const rows = await loadTeamRows(tx, session.tenantId);
      const found = new Map(rows.map((r) => [r.id, r]));

      const result: BulkActionResult = { succeeded: [], failed: [] };
      const wrapperUpdates: { id: string; fromRole: TeamRole; toRole: TeamRole }[] = [];

      for (const id of data.userIds) {
        const target = found.get(id);
        if (!target) {
          result.failed.push({ userId: id, reason: "User not found." });
          continue;
        }
        if (target.id === session.subjectId) {
          result.failed.push({ userId: id, reason: "You can't change your own role." });
          continue;
        }
        const lastSuper = await isLastSuperAdmin(tx, target.id, session.tenantId, target.role, target.status);
        try {
          assertActionAllowed("changeRole", target.status, { isLastSuperAdmin: lastSuper });
        } catch (e) {
          result.failed.push({ userId: id, reason: e instanceof Error ? e.message : "Not allowed." });
          continue;
        }
        if (target.role === data.role) {
          result.succeeded.push(id); // Already the target role — no-op counts as success.
          continue;
        }
        await tx.auditLog.create({
          data: {
            tenantId: session.tenantId,
            actorId: session.subjectId,
            ...actorCols(dualFkForUser(session.subjectId, session.role)),
            action: "ROLE_CHANGE",
            fromValue: target.role,
            toValue: data.role,
          },
        });
        result.succeeded.push(id);
        wrapperUpdates.push({ id: target.id, fromRole: target.role, toRole: data.role });
      }

      return { result, wrapperUpdates };
    }
  );

  // Wrapper role propagation happens after the Support-side tx commits.
  // Cross-boundary changes (CLIENT ↔ staff) throw and get demoted to
  // `failed` — legacy behavior silently drifted; explicit reasons now.
  for (const upd of wrapperUpdates) {
    try {
      await updateWrapperCounterpartRole(session.tenantId, upd.id, upd.fromRole, upd.toRole);
    } catch (e) {
      const idx = result.succeeded.indexOf(upd.id);
      if (idx >= 0) result.succeeded.splice(idx, 1);
      result.failed.push({
        userId: upd.id,
        reason: e instanceof Error ? e.message : "Wrapper role update failed.",
      });
    }
  }

  revalidatePath("/admin/team");
  return result;
}

export async function bulkDeactivate(input: z.infer<typeof bulkUserIdsSchema>): Promise<BulkActionResult> {
  const session = await requireSession({ minRole: "ADMIN" });
  const data = bulkUserIdsSchema.parse(input);

  return withRls({ tenantId: session.tenantId, userId: session.subjectId, role: session.role }, async (tx) => {
    const rows = await loadTeamRows(tx, session.tenantId);
    const found = new Map(rows.map((r) => [r.id, r]));

    const result: BulkActionResult = { succeeded: [], failed: [] };
    for (const id of data.userIds) {
      const target = found.get(id);
      if (!target) {
        result.failed.push({ userId: id, reason: "User not found." });
        continue;
      }
      if (target.id === session.subjectId) {
        result.failed.push({ userId: id, reason: "You can't deactivate yourself." });
        continue;
      }
      const lastSuper = await isLastSuperAdmin(tx, target.id, session.tenantId, target.role, target.status);
      try {
        assertActionAllowed("deactivate", target.status, { isLastSuperAdmin: lastSuper });
      } catch (e) {
        result.failed.push({ userId: id, reason: e instanceof Error ? e.message : "Not allowed." });
        continue;
      }
      const patch = { status: "SUSPENDED" as const };
      if (target.role === "CLIENT") {
        await tx.endUserLifecycle.upsert({
          where: { subjectId: target.id },
          create: { subjectId: target.id, tenantId: session.tenantId, ...patch },
          update: patch,
        });
      } else {
        await tx.teamMemberLifecycle.upsert({
          where: { subjectId: target.id },
          create: { subjectId: target.id, tenantId: session.tenantId, ...patch },
          update: patch,
        });
      }
      await tx.auditLog.create({
        data: {
          tenantId: session.tenantId,
          actorId: session.subjectId,
          ...actorCols(dualFkForUser(session.subjectId, session.role)),
          action: "DEACTIVATE_USER",
          toValue: target.email,
        },
      });
      result.succeeded.push(id);
    }

    revalidatePath("/admin/team");
    return result;
  });
}

/**
 * CSV export of the selected users (spec §4). Returns the raw CSV string so
 * the client can trigger a Blob download — a signed-URL/storage flow would
 * be over-engineered for team-sized lists (dozens to low hundreds); this
 * generates the file in the same server-action call. Fields match the spec:
 * name, email, company, role, status, lastActiveAt.
 */
export async function bulkExport(input: z.infer<typeof bulkUserIdsSchema>): Promise<{ ok: true; csv: string; filename: string } | { ok: false; error: string }> {
  const session = await requireSession({ minRole: "ADMIN" });
  const data = bulkUserIdsSchema.parse(input);

  const rows = await withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    async (tx) => {
      const all = await loadTeamRows(tx, session.tenantId);
      const wanted = new Set(data.userIds);
      return all
        .filter((r) => wanted.has(r.id))
        .sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));
    }
  );

  if (rows.length === 0) return { ok: false, error: "No rows found for export." };

  const header = ["Name", "Email", "Company", "Role", "Status", "Last active"];
  const escape = (v: string | null | undefined) => {
    if (v == null) return "";
    const s = String(v);
    // RFC 4180: fields containing ,/"/newline get quoted, and internal
    // quotes get doubled. Every field gets quoted here for uniformity.
    return `"${s.replace(/"/g, '""')}"`;
  };
  const lines = [
    header.map(escape).join(","),
    ...rows.map((u) =>
      [
        u.name,
        u.email,
        u.companyRef?.name ?? u.company,
        u.role,
        u.status,
        u.lastActiveAt ? u.lastActiveAt.toISOString() : "",
      ]
        .map(escape)
        .join(",")
    ),
  ];
  const csv = lines.join("\r\n") + "\r\n";
  const stamp = new Date().toISOString().slice(0, 10);
  return { ok: true, csv, filename: `team-export-${stamp}.csv` };
}

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

export async function listAllCategories() {
  const session = await requireSession({ minRole: "ADMIN" });
  return withRls({ tenantId: session.tenantId, userId: session.subjectId, role: session.role }, (tx) =>
    tx.category.findMany({ where: { tenantId: session.tenantId }, orderBy: { name: "asc" } })
  );
}

export async function upsertCategory(
  input: z.infer<typeof upsertCategorySchema>
): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await requireSession({ minRole: "ADMIN" });

  // safeParse: a rejected name (garbage/symbols-only, wrong charset, etc.)
  // needs to reach the client as a specific message — a thrown ZodError gets
  // redacted by Next.js in production into a generic, useless message.
  const parsed = upsertCategorySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid category name." };
  const data = parsed.data;

  return withRls({ tenantId: session.tenantId, userId: session.subjectId, role: session.role }, async (tx) => {
    if (data.id) {
      const category = await tx.category.updateMany({
        where: { id: data.id, tenantId: session.tenantId },
        data: { name: data.name, isActive: data.isActive },
      });
      if (category.count === 0) return { ok: false, error: "Category not found." };
    } else {
      await tx.category.create({
        data: { tenantId: session.tenantId, name: data.name, isActive: data.isActive },
      });
    }
    revalidatePath("/admin/categories");
    return { ok: true };
  });
}

// ---------------------------------------------------------------------------
// Branding
// ---------------------------------------------------------------------------

export async function getBranding() {
  const session = await requireSession({ minRole: "ADMIN" });
  return withRls({ tenantId: session.tenantId, userId: session.subjectId, role: session.role }, (tx) =>
    tx.tenantBranding.findUnique({ where: { tenantId: session.tenantId } })
  );
}

export async function updateBranding(input: z.infer<typeof updateBrandingSchema>) {
  const session = await requireSession({ minRole: "ADMIN" });
  const data = updateBrandingSchema.parse(input);

  // Warn (don't block) if the primary color would fail WCAG AA against
  // white — brand guidelines already flag orange-on-white as large-text-only.
  const contrastWarning =
    contrastRatio(data.primaryColor, "#FFFFFF") < 3
      ? "This primary color has low contrast on white — use it for large/bold elements only, not body text."
      : null;

  await withRls({ tenantId: session.tenantId, userId: session.subjectId, role: session.role }, async (tx) => {
    await tx.tenantBranding.update({
      where: { tenantId: session.tenantId },
      data: {
        productName: data.productName,
        primaryColor: data.primaryColor,
        accentColor: data.accentColor,
        logoUrl: data.logoUrl || null,
        supportEmail: data.supportEmail || null,
        emailFromName: data.emailFromName || null,
      },
    });
    await tx.auditLog.create({
      data: { tenantId: session.tenantId, actorId: session.subjectId, ...actorCols(dualFkForUser(session.subjectId, session.role)), action: "UPDATE_BRANDING" },
    });
  });

  revalidatePath("/admin/branding");
  revalidatePath("/", "layout");
  return { ok: true, contrastWarning };
}

/**
 * Uploads a tenant's logo image to Supabase Storage and returns its public
 * URL — WITHOUT persisting it to the branding record. Persisting only happens
 * when the admin clicks "Save branding" (updateBranding writes logoUrl), so
 * the returned URL is purely staged into the form's live preview until then.
 *
 * Two things make that "stage, don't apply" guarantee hold:
 *   1. No tenantBranding.update / revalidate here — the DB (and therefore the
 *      live platform) is untouched by an upload alone.
 *   2. A unique, timestamped object path per upload instead of a fixed
 *      "logo.<ext>" upsert path — otherwise the new file would overwrite the
 *      object the *currently-saved* logoUrl still points to, changing the live
 *      logo even without a DB write. (Previously both were violated, which is
 *      why a logo went live before Save was ever clicked.)
 */
export async function uploadBrandingLogo(formData: FormData) {
  const session = await requireSession({ minRole: "ADMIN" });
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false as const, error: "No file provided." };

  const ext = file.name.split(".").pop()?.toLowerCase() || "png";
  const result = await uploadImage("branding-logos", `${session.tenantId}/logo-${Date.now()}.${ext}`, file);
  if (!result.ok) return { ok: false as const, error: result.error };

  return { ok: true as const, url: result.url };
}

// ---------------------------------------------------------------------------
// Audit log
// ---------------------------------------------------------------------------

export async function listAuditLog(filter: Partial<z.infer<typeof auditLogFilterSchema>> = {}) {
  const session = await requireSession({ minRole: "ADMIN" });
  const f = auditLogFilterSchema.parse(filter);
  const PAGE_SIZE = 50;

  const rows = await withRls({ tenantId: session.tenantId, userId: session.subjectId, role: session.role }, (tx) =>
    tx.auditLog.findMany({
      where: { tenantId: session.tenantId, action: f.action },
      include: { ticket: true },
      orderBy: { createdAt: "desc" },
      skip: (f.page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    })
  );

  // Z1.4b: actor resolution via wrapper. Actor may be an EndUser, a
  // TeamMember, or fully null (SYSTEM — auto-close, backfills, etc.).
  // See docs/shared-platform-boundary.md §7.2 for why the CHECK allows
  // 0 non-nulls.
  const wrapperCtx = systemContext(session.tenantId);
  const endUserIds = new Set<string>();
  const teamMemberIds = new Set<string>();
  for (const r of rows) {
    if (r.actorEndUserId) endUserIds.add(r.actorEndUserId);
    if (r.actorTeamMemberId) teamMemberIds.add(r.actorTeamMemberId);
  }
  const [endUsers, teamMembers] = await Promise.all([
    getEndUsersByIds(wrapperCtx, [...endUserIds]),
    getTeamMembersByIds(wrapperCtx, [...teamMemberIds]),
  ]);

  return rows.map((r) => ({
    ...r,
    actor: resolveAuditActor(
      { actorEndUserId: r.actorEndUserId, actorTeamMemberId: r.actorTeamMemberId },
      endUsers,
      teamMembers,
    ),
  }));
}

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

export async function getReportStats() {
  const session = await requireSession({ minRole: "ADMIN" });

  return withRls({ tenantId: session.tenantId, userId: session.subjectId, role: session.role }, async (tx) => {
    const tenantId = session.tenantId;
    // Sequential, not Promise.all: these all run on this one interactive-tx
    // connection, so concurrent issue is unsupported by Prisma (and gives no
    // real parallelism anyway — a single connection serializes them regardless).
    const byStatus = await tx.ticket.groupBy({ by: ["status"], where: { tenantId }, _count: true });
    const byPriority = await tx.ticket.groupBy({ by: ["priority"], where: { tenantId }, _count: true });
    const total = await tx.ticket.count({ where: { tenantId } });
    const unassigned = await tx.ticket.count({
      where: { tenantId, assignedToId: null, status: { notIn: ["RESOLVED", "CLOSED"] } },
    });
    const tickets = await tx.ticket.findMany({
      where: { tenantId, firstReplyAt: { not: null } },
      select: { createdAt: true, firstReplyAt: true },
    });

    const avgFirstResponseHours =
      tickets.length > 0
        ? Math.max(
            0,
            tickets.reduce((sum, t) => sum + (t.firstReplyAt!.getTime() - t.createdAt.getTime()), 0) /
              tickets.length /
              (1000 * 60 * 60)
          )
        : null;

    // 30-day daily series for the "tickets over time" chart. Two lightweight
    // queries (created and resolved separately, since a ticket resolved in the
    // window may have been created before it) bucketed by local calendar day.
    const DAYS = 30;
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - (DAYS - 1));

    const createdRows = await tx.ticket.findMany({
      where: { tenantId, createdAt: { gte: start } },
      select: { createdAt: true },
    });
    const resolvedRows = await tx.ticket.findMany({
      where: { tenantId, resolvedAt: { gte: start } },
      select: { resolvedAt: true },
    });

    const dayKey = (d: Date) => {
      const x = new Date(d);
      x.setHours(0, 0, 0, 0);
      return x.toISOString().slice(0, 10);
    };
    const createdByDay = new Map<string, number>();
    for (const r of createdRows) createdByDay.set(dayKey(r.createdAt), (createdByDay.get(dayKey(r.createdAt)) ?? 0) + 1);
    const resolvedByDay = new Map<string, number>();
    for (const r of resolvedRows) {
      if (!r.resolvedAt) continue;
      resolvedByDay.set(dayKey(r.resolvedAt), (resolvedByDay.get(dayKey(r.resolvedAt)) ?? 0) + 1);
    }

    const dailySeries = Array.from({ length: DAYS }, (_, i) => {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      const key = d.toISOString().slice(0, 10);
      const created = createdByDay.get(key) ?? 0;
      const resolved = resolvedByDay.get(key) ?? 0;
      return { date: key, created, resolved, net: created - resolved };
    });

    return {
      total,
      unassigned,
      byStatus: Object.fromEntries(byStatus.map((s) => [s.status, s._count])),
      byPriority: Object.fromEntries(byPriority.map((p) => [p.priority, p._count])),
      avgFirstResponseHours,
      dailySeries,
    };
  });
}

// ---------------------------------------------------------------------------
// Analytics (/admin/analytics) — a deeper, filterable dashboard than the
// Reports section above, which stays untouched and keeps powering the plain
// Overview page.
// ---------------------------------------------------------------------------

function resolveRange(f: AnalyticsFilter): { start: Date; end: Date } {
  const end = f.range === "custom" && f.to ? new Date(f.to) : new Date();
  end.setHours(23, 59, 59, 999);

  let days = 30;
  if (f.range === "7d") days = 7;
  else if (f.range === "90d") days = 90;

  let start: Date;
  if (f.range === "custom" && f.from) {
    start = new Date(f.from);
    start.setHours(0, 0, 0, 0);
  } else {
    start = new Date();
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - (days - 1));
  }
  return { start, end };
}

function buildTicketWhere(tenantId: string, f: AnalyticsFilter, dateField: "createdAt" | "resolvedAt" = "createdAt") {
  const { start, end } = resolveRange(f);
  return {
    tenantId,
    [dateField]: { gte: start, lte: end },
    ...(f.channel ? { source: f.channel } : {}),
    ...(f.categoryId ? { categoryId: f.categoryId } : {}),
    ...(f.priority ? { priority: f.priority } : {}),
    ...(f.assignedToId
      ? f.assignedToId === "unassigned"
        ? { assignedToId: null }
        : { assignedToId: f.assignedToId }
      : {}),
  };
}

// Same plain-Date bucketing style as getReportStats() above, extended with a
// `net` column and a variable-length window (instead of a hardcoded 30 days).
function bucketByDay(start: Date, end: Date, createdDates: Date[], resolvedDates: Date[]) {
  const dayKey = (d: Date) => {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    return x.toISOString().slice(0, 10);
  };
  const createdByDay = new Map<string, number>();
  for (const d of createdDates) createdByDay.set(dayKey(d), (createdByDay.get(dayKey(d)) ?? 0) + 1);
  const resolvedByDay = new Map<string, number>();
  for (const d of resolvedDates) resolvedByDay.set(dayKey(d), (resolvedByDay.get(dayKey(d)) ?? 0) + 1);

  const days = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1);
  return Array.from({ length: days }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    const key = d.toISOString().slice(0, 10);
    const created = createdByDay.get(key) ?? 0;
    const resolved = resolvedByDay.get(key) ?? 0;
    return { date: key, created, resolved, net: created - resolved };
  });
}

// grid[dayOfWeek][hourOfDay] = ticket count. dayOfWeek: 0=Sun..6=Sat (JS Date
// convention), using the server process's local timezone — same implicit
// assumption getReportStats()'s day-bucketing already makes; there's no
// per-tenant timezone field in the schema to do better.
function buildHeatmap(dates: Date[]): number[][] {
  const grid: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0));
  for (const d of dates) grid[d.getDay()][d.getHours()] += 1;
  return grid;
}

export async function getAnalyticsOverview(rawFilter: Partial<AnalyticsFilter> = {}) {
  const session = await requireSession({ minRole: "ADMIN" });
  const parsed = analyticsFilterSchema.safeParse(rawFilter);
  // Never throw on a bad/stale filter (e.g. a hand-edited or old bookmarked
  // URL) — fall back to the schema's own defaults instead.
  const f = parsed.success ? parsed.data : analyticsFilterSchema.parse({});

  return withRls({ tenantId: session.tenantId, userId: session.subjectId, role: session.role }, async (tx) => {
    const tenantId = session.tenantId;
    const { start, end } = resolveRange(f);
    const createdWhere = buildTicketWhere(tenantId, f, "createdAt");

    // Sequential, not Promise.all — same reason as getReportStats() above:
    // these all run on this one interactive-tx connection.

    // --- KPI row: volume, first response ---
    const totalInRange = await tx.ticket.count({ where: createdWhere });
    const openInRange = await tx.ticket.count({ where: { ...createdWhere, status: { in: ["OPEN", "IN_PROGRESS", "PENDING"] } } });
    const unassignedOpenInRange = await tx.ticket.count({
      where: { ...createdWhere, status: { in: ["OPEN", "IN_PROGRESS", "PENDING"] }, assignedToId: null },
    });
    const resolvedInRange = await tx.ticket.count({ where: { ...createdWhere, resolvedAt: { not: null } } });
    const withFirstReply = await tx.ticket.findMany({
      where: { ...createdWhere, firstReplyAt: { not: null } },
      select: { createdAt: true, firstReplyAt: true, priority: true },
    });
    const avgFirstResponseHours =
      withFirstReply.length > 0
        ? Math.max(
            0,
            withFirstReply.reduce((sum, t) => sum + (t.firstReplyAt!.getTime() - t.createdAt.getTime()), 0) /
              withFirstReply.length /
              (1000 * 60 * 60)
          )
        : null;

    // --- SLA compliance KPI ---
    // Compliance: of tickets with a first reply, what fraction replied within
    // their priority's fixed threshold. At-risk: currently-open tickets (in
    // range/filters) that have blown past their threshold with no reply yet.
    const slaCompliantCount = withFirstReply.filter(
      (t) => (t.firstReplyAt!.getTime() - t.createdAt.getTime()) / (1000 * 60 * 60) <= SLA_THRESHOLD_HOURS[t.priority]
    ).length;
    const slaComplianceRate = withFirstReply.length > 0 ? slaCompliantCount / withFirstReply.length : null;
    const openNoReply = await tx.ticket.findMany({
      where: { ...createdWhere, status: { in: ["OPEN", "IN_PROGRESS", "PENDING"] }, firstReplyAt: null },
      select: { createdAt: true, priority: true },
    });
    const now = Date.now();
    const slaAtRiskCount = openNoReply.filter(
      (t) => (now - t.createdAt.getTime()) / (1000 * 60 * 60) > SLA_THRESHOLD_HOURS[t.priority]
    ).length;

    // --- CSAT KPI ---
    // Scoped by the related ticket's createdAt + filters, same as every
    // other range-scoped metric on this page (a rating with no ticket match
    // in range/filters shouldn't count).
    const csatRows = await tx.surveyResponse.findMany({
      where: { tenantId, ticket: createdWhere },
      select: { rating: true },
    });
    const avgCsatRating = csatRows.length > 0 ? csatRows.reduce((sum, r) => sum + r.rating, 0) / csatRows.length : null;

    // --- Reopen-rate KPI ---
    const reopenedCount = await tx.ticket.count({ where: { ...createdWhere, reopenCount: { gt: 0 } } });
    const reopenRate = totalInRange > 0 ? reopenedCount / totalInRange : null;

    // --- AI-deflection % KPI ---
    // A conversation counts as "deflected" if it never escalated to a human
    // ticket. Chat conversations have no category/priority/channel/agent, so
    // only the date range applies here — the UI should caption this so it
    // doesn't look broken when those other filters don't move this number.
    const totalConversations = await tx.chatConversation.count({ where: { tenantId, createdAt: { gte: start, lte: end } } });
    const escalatedConversations = await tx.chatConversation.count({
      where: { tenantId, createdAt: { gte: start, lte: end }, status: "escalated" },
    });
    const aiDeflectionRate = totalConversations > 0 ? (totalConversations - escalatedConversations) / totalConversations : null;

    // --- Tickets-over-time (created / resolved / net) ---
    const createdRows = await tx.ticket.findMany({ where: createdWhere, select: { createdAt: true } });
    const resolvedWhere = buildTicketWhere(tenantId, f, "resolvedAt");
    const resolvedRows = await tx.ticket.findMany({
      where: { ...resolvedWhere, resolvedAt: { not: null } },
      select: { resolvedAt: true },
    });
    const dailySeries = bucketByDay(
      start,
      end,
      createdRows.map((r) => r.createdAt),
      resolvedRows.map((r) => r.resolvedAt!)
    );

    // --- Category breakdown ---
    const byCategory = await tx.ticket.groupBy({ by: ["categoryId"], where: createdWhere, _count: true });
    const categoryIds = byCategory.map((c) => c.categoryId).filter((id): id is string => id !== null);
    const categoriesById =
      categoryIds.length > 0
        ? await tx.category.findMany({ where: { id: { in: categoryIds }, tenantId }, select: { id: true, name: true } })
        : [];
    const categoryNameById = new Map(categoriesById.map((c) => [c.id, c.name]));
    const categoryBreakdown = byCategory
      .map((c) => ({
        label: c.categoryId ? (categoryNameById.get(c.categoryId) ?? "Unknown category") : "Uncategorized",
        value: c._count,
      }))
      .sort((a, b) => b.value - a.value);

    // --- Channel breakdown ---
    const bySource = await tx.ticket.groupBy({ by: ["source"], where: createdWhere, _count: true });
    const channelBreakdown = bySource.map((s) => ({ label: s.source, value: s._count })).sort((a, b) => b.value - a.value);

    // --- Clients by region (map + top-regions table) ---
    // clientCountry only populates for tickets created through a live
    // request (portal/chatbot) going forward — see actions/tickets.ts's
    // createTicket(). Existing/historical tickets have no captured IP, so
    // this is expected to be sparse until new activity accumulates; null is
    // surfaced as its own "Unknown" bucket rather than silently dropped.
    const byCountry = await tx.ticket.groupBy({ by: ["clientCountry"], where: createdWhere, _count: true });
    const countryResolvedRows = await tx.ticket.findMany({
      where: { ...createdWhere, clientCountry: { not: null }, resolvedAt: { not: null } },
      select: { clientCountry: true, createdAt: true, resolvedAt: true },
    });
    const countryResAcc = new Map<string, { sum: number; count: number }>();
    for (const t of countryResolvedRows) {
      const key = t.clientCountry!;
      const hrs = Math.max(0, (t.resolvedAt!.getTime() - t.createdAt.getTime()) / (1000 * 60 * 60));
      const acc = countryResAcc.get(key) ?? { sum: 0, count: 0 };
      acc.sum += hrs;
      acc.count += 1;
      countryResAcc.set(key, acc);
    }
    const regionBreakdown = byCountry
      .map((c) => {
        const code = c.clientCountry;
        const acc = code ? countryResAcc.get(code) : undefined;
        const centroid = code ? COUNTRIES[code] : undefined;
        return {
          code,
          label: countryName(code),
          value: c._count,
          avgResolutionHours: acc && acc.count > 0 ? acc.sum / acc.count : null,
          lat: centroid?.lat ?? null,
          lon: centroid?.lon ?? null,
        };
      })
      .sort((a, b) => b.value - a.value)
      .slice(0, 8);

    // --- Agent leaderboard ---
    const byAgent = await tx.ticket.groupBy({
      by: ["assignedToId"],
      where: { ...createdWhere, assignedToId: { not: null } },
      _count: true,
    });
    const agentIds = byAgent.map((a) => a.assignedToId).filter((id): id is string => id !== null);
    // Z1.4b: agent names come from the wrapper (TeamMember, preserved id).
    const agentsByIdMap = await getTeamMembersByIds(systemContext(tenantId), agentIds);
    const agentNameById = new Map<string, string | null>(
      Array.from(agentsByIdMap.values()).map((tm) => [tm.id, tm.name]),
    );
    // Avg resolution time needs raw created/resolved pairs (groupBy can't avg
    // a computed diff) — pulled once and reused for both each agent's own
    // average AND the KPI-level overall average, to avoid two overlapping
    // findMany calls over the same rows. Note this means the KPI-level
    // avgResolutionHours only covers assigned+resolved tickets.
    const resolvedByAgentRows = await tx.ticket.findMany({
      where: { ...createdWhere, assignedToId: { not: null }, resolvedAt: { not: null } },
      select: { assignedToId: true, createdAt: true, resolvedAt: true },
    });
    const resolutionAccByAgent = new Map<string, { sum: number; count: number }>();
    let overallResSum = 0;
    let overallResCount = 0;
    for (const t of resolvedByAgentRows) {
      const key = t.assignedToId!;
      // Clamp like avgFirstResponseHours above — seed/clock-skew data can
      // have resolvedAt fractionally before createdAt, which would otherwise
      // surface as a nonsensical negative average.
      const hrs = Math.max(0, (t.resolvedAt!.getTime() - t.createdAt.getTime()) / (1000 * 60 * 60));
      const acc = resolutionAccByAgent.get(key) ?? { sum: 0, count: 0 };
      acc.sum += hrs;
      acc.count += 1;
      resolutionAccByAgent.set(key, acc);
      overallResSum += hrs;
      overallResCount += 1;
    }
    const avgResolutionHours = overallResCount > 0 ? overallResSum / overallResCount : null;

    // Per-agent CSAT: join ratings to their ticket's assignedToId, scoped by
    // the same createdWhere filter set used everywhere else on this page.
    const agentCsatRows = await tx.surveyResponse.findMany({
      where: { tenantId, ticket: { ...createdWhere, assignedToId: { not: null } } },
      select: { rating: true, ticket: { select: { assignedToId: true } } },
    });
    const csatAccByAgent = new Map<string, { sum: number; count: number }>();
    for (const r of agentCsatRows) {
      const key = r.ticket.assignedToId!;
      const acc = csatAccByAgent.get(key) ?? { sum: 0, count: 0 };
      acc.sum += r.rating;
      acc.count += 1;
      csatAccByAgent.set(key, acc);
    }

    const agentLeaderboard = byAgent
      .map((a) => {
        const acc = resolutionAccByAgent.get(a.assignedToId!);
        const csatAcc = csatAccByAgent.get(a.assignedToId!);
        return {
          agentId: a.assignedToId!,
          agentName: agentNameById.get(a.assignedToId!) ?? "Unknown",
          handledCount: a._count,
          avgResolutionHours: acc && acc.count > 0 ? acc.sum / acc.count : null,
          avgCsatRating: csatAcc && csatAcc.count > 0 ? csatAcc.sum / csatAcc.count : null,
        };
      })
      .sort((a, b) => b.handledCount - a.handledCount);

    // --- Peak-hours heatmap (day-of-week x hour-of-day) ---
    const heatmapRows = await tx.ticket.findMany({ where: createdWhere, select: { createdAt: true } });
    const heatmap = buildHeatmap(heatmapRows.map((r) => r.createdAt));

    // --- Filter option lists, for the FilterBar's <select> populations ---
    const allCategories = await tx.category.findMany({
      where: { tenantId, isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    });
    // Z1.4b: agent list for the analytics filter dropdown comes from
    // the wrapper. Same "exclude Super Admin, sort by name" shape as
    // listAgents() in actions/tickets.ts — same rationale.
    const wrapperCtxAnalytics = systemContext(tenantId);
    const [tmPage, superAdminRole] = await Promise.all([
      listTeamMembers(wrapperCtxAnalytics, { limit: 200 }),
      getRoleByName(wrapperCtxAnalytics, "Super Admin"),
    ]);
    const allAgents = tmPage.items
      .filter((tm) => !superAdminRole || tm.roleId !== superAdminRole.id)
      .map((tm) => ({ id: tm.id, name: tm.name ?? "" }))
      .sort((a, b) => a.name.localeCompare(b.name));

    return {
      filter: f,
      kpis: {
        totalInRange,
        openInRange,
        unassignedOpenInRange,
        resolvedInRange,
        avgFirstResponseHours,
        avgResolutionHours,
        reopenRate,
        aiDeflectionRate,
        slaComplianceRate,
        slaAtRiskCount,
        avgCsatRating,
      },
      dailySeries,
      categoryBreakdown,
      channelBreakdown,
      regionBreakdown,
      agentLeaderboard,
      heatmap,
      filterOptions: { categories: allCategories, agents: allAgents },
    };
  });
}
