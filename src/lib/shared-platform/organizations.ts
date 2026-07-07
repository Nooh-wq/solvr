// Organization wrapper — replaces the legacy Company table.
// See docs/shared-platform-boundary.md.

import { Prisma } from "@/generated/prisma";
import { withRls } from "@/lib/db";
import type { WrapperContext } from "./context";
import type {
  CreateOrganizationInput,
  ListFilter,
  Organization,
  Page,
  UpdateOrganizationInput,
} from "./types";
import { WrapperConflictError, WrapperNotFoundError } from "./errors";
import { writeCoreAuditLogInTx } from "./audit";

// Personal-mail domains never auto-match an Organization. Ports the
// exact set from src/lib/company-match.ts so behavior is identical to
// the legacy Company auto-match.
const PERSONAL_DOMAINS = new Set([
  "gmail.com", "yahoo.com", "hotmail.com", "outlook.com", "icloud.com",
  "aol.com", "protonmail.com", "proton.me", "live.com", "msn.com",
  "me.com", "mail.com", "gmx.com", "zoho.com", "yandex.com",
]);

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

export async function getOrganization(
  ctx: WrapperContext,
  id: string
): Promise<Organization | null> {
  const row = await withRls(
    { tenantId: ctx.tenantId, userId: ctx.actor?.teamMemberId ?? null, role: "SUPER_ADMIN" },
    (tx) => tx.organization.findFirst({ where: { id, tenantId: ctx.tenantId } })
  );
  return row ? toDto(row) : null;
}

export async function listOrganizations(
  ctx: WrapperContext,
  filter?: ListFilter
): Promise<Page<Organization>> {
  const limit = clampLimit(filter?.limit);
  const rows = await withRls(
    { tenantId: ctx.tenantId, userId: ctx.actor?.teamMemberId ?? null, role: "SUPER_ADMIN" },
    (tx) =>
      tx.organization.findMany({
        where: {
          tenantId: ctx.tenantId,
          ...(filter?.search && {
            OR: [
              { name: { contains: filter.search, mode: "insensitive" } },
              { domain: { contains: filter.search, mode: "insensitive" } },
            ],
          }),
        },
        orderBy: [{ name: "asc" }, { id: "asc" }],
        take: limit + 1,
        ...(filter?.cursor && { cursor: { id: filter.cursor }, skip: 1 }),
      })
  );
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  return {
    items: page.map(toDto),
    nextCursor: hasMore ? page[page.length - 1].id : null,
  };
}

/**
 * Auto-match by email domain. Ports the exact logic from Support's
 * legacy src/lib/company-match.ts so behavior is identical: personal
 * mail domains (gmail.com etc.) never match, even if a Company row
 * exists for that domain — otherwise every gmail signup would be
 * silently attached to a stray Organization.
 */
export async function matchOrganizationByEmailDomain(
  ctx: WrapperContext,
  email: string
): Promise<Organization | null> {
  const domain = extractCompanyDomain(email);
  if (!domain) return null;
  const row = await withRls(
    { tenantId: ctx.tenantId, userId: ctx.actor?.teamMemberId ?? null, role: "SUPER_ADMIN" },
    (tx) => tx.organization.findFirst({ where: { tenantId: ctx.tenantId, domain } })
  );
  return row ? toDto(row) : null;
}

/**
 * Batch id lookup. Returns a Map keyed by id — callers can `.get(id)`
 * without needing to array-search. Missing ids are simply absent from
 * the Map. Empty input returns empty Map.
 *
 * Z1.4b addition — see docs/shared-platform-boundary.md §7.9.
 * Post-M7, this maps to `GET /api/v1/organizations?ids=...`.
 */
export async function getOrganizationsByIds(
  ctx: WrapperContext,
  ids: readonly string[]
): Promise<Map<string, Organization>> {
  if (ids.length === 0) return new Map();
  const rows = await withRls(
    { tenantId: ctx.tenantId, userId: ctx.actor?.teamMemberId ?? null, role: "SUPER_ADMIN" },
    (tx) =>
      tx.organization.findMany({
        where: { tenantId: ctx.tenantId, id: { in: [...ids] } },
      })
  );
  return new Map(rows.map((r) => [r.id, toDto(r)]));
}

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

export async function createOrganization(
  ctx: WrapperContext,
  input: CreateOrganizationInput
): Promise<Organization> {
  return withRls(
    { tenantId: ctx.tenantId, userId: ctx.actor?.teamMemberId ?? null, role: "SUPER_ADMIN" },
    async (tx) => {
      try {
        const row = await tx.organization.create({
          data: {
            // input.id is set only by Z1.3 backfill (see types.ts note).
            // Online callers leave it undefined and Prisma allocates cuid().
            ...(input.id && { id: input.id }),
            tenantId: ctx.tenantId,
            name: input.name,
            domain: input.domain ?? null,
          },
        });
        await writeCoreAuditLogInTx(tx, ctx, {
          action: "CREATE",
          resourceType: "Organization",
          resourceId: row.id,
          toValue: { name: row.name, domain: row.domain },
        });
        return toDto(row);
      } catch (e) {
        throw translateUnique(e, "Organization", "name", input.name);
      }
    }
  );
}

export async function updateOrganization(
  ctx: WrapperContext,
  id: string,
  patch: UpdateOrganizationInput
): Promise<Organization> {
  return withRls(
    { tenantId: ctx.tenantId, userId: ctx.actor?.teamMemberId ?? null, role: "SUPER_ADMIN" },
    async (tx) => {
      const existing = await tx.organization.findFirst({ where: { id, tenantId: ctx.tenantId } });
      if (!existing) throw new WrapperNotFoundError("Organization", id);
      try {
        const updated = await tx.organization.update({
          where: { id },
          data: {
            ...(patch.name !== undefined && { name: patch.name }),
            ...(patch.domain !== undefined && { domain: patch.domain }),
          },
        });
        await writeCoreAuditLogInTx(tx, ctx, {
          action: "UPDATE",
          resourceType: "Organization",
          resourceId: id,
          fromValue: { name: existing.name, domain: existing.domain },
          toValue: { name: updated.name, domain: updated.domain },
        });
        return toDto(updated);
      } catch (e) {
        throw translateUnique(e, "Organization", "name", patch.name ?? existing.name);
      }
    }
  );
}

export async function deleteOrganization(ctx: WrapperContext, id: string): Promise<void> {
  await withRls(
    { tenantId: ctx.tenantId, userId: ctx.actor?.teamMemberId ?? null, role: "SUPER_ADMIN" },
    async (tx) => {
      const existing = await tx.organization.findFirst({ where: { id, tenantId: ctx.tenantId } });
      if (!existing) throw new WrapperNotFoundError("Organization", id);
      // DB cascades: end_user_organizations rows removed; end_users.organizationId SET NULL.
      await tx.organization.delete({ where: { id } });
      await writeCoreAuditLogInTx(tx, ctx, {
        action: "DELETE",
        resourceType: "Organization",
        resourceId: id,
        fromValue: { name: existing.name, domain: existing.domain },
      });
    }
  );
}

/**
 * Backfill / tenant-provisioning helper. Idempotent create-or-fetch by
 * (tenantId, name). If found, applies PATCH-style overwrite of extras
 * (currently just `domain`) — see boundary doc §7.2 for the overwrite
 * semantics and rationale (backfill correctness under re-run).
 */
export async function upsertOrganizationByName(
  ctx: WrapperContext,
  name: string,
  extras?: { domain?: string | null }
): Promise<Organization> {
  return withRls(
    { tenantId: ctx.tenantId, userId: ctx.actor?.teamMemberId ?? null, role: "SUPER_ADMIN" },
    async (tx) => {
      const existing = await tx.organization.findFirst({
        where: { tenantId: ctx.tenantId, name },
      });
      if (!existing) {
        const row = await tx.organization.create({
          data: {
            tenantId: ctx.tenantId,
            name,
            domain: extras?.domain ?? null,
          },
        });
        await writeCoreAuditLogInTx(tx, ctx, {
          action: "CREATE",
          resourceType: "Organization",
          resourceId: row.id,
          toValue: { name: row.name, domain: row.domain },
        });
        return toDto(row);
      }
      // Overwrite semantics — only fields explicitly present in extras
      // are considered; missing keys leave existing values untouched.
      const nextDomain = extras && "domain" in extras ? (extras.domain ?? null) : existing.domain;
      if (nextDomain === existing.domain) return toDto(existing);
      const updated = await tx.organization.update({
        where: { id: existing.id },
        data: { domain: nextDomain },
      });
      await writeCoreAuditLogInTx(tx, ctx, {
        action: "UPDATE",
        resourceType: "Organization",
        resourceId: updated.id,
        fromValue: { domain: existing.domain },
        toValue: { domain: updated.domain },
      });
      return toDto(updated);
    }
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractCompanyDomain(email: string): string | null {
  const domain = email.split("@")[1]?.toLowerCase();
  if (!domain) return null;
  if (PERSONAL_DOMAINS.has(domain)) return null;
  return domain;
}

function toDto(row: {
  id: string;
  tenantId: string;
  name: string;
  domain: string | null;
  createdAt: Date;
  updatedAt: Date;
}): Organization {
  return {
    id: row.id,
    tenantId: row.tenantId,
    name: row.name,
    domain: row.domain,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function translateUnique(e: unknown, resourceType: string, field: string, value: string): unknown {
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
    return new WrapperConflictError(resourceType, field, value);
  }
  return e;
}

function clampLimit(limit?: number): number {
  return Math.min(Math.max(limit ?? 50, 1), 200);
}
