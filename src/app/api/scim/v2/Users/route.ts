// M6.5 — SCIM 2.0 /Users endpoint (POST creates + GET lists).
//
// Minimal spec-compliant subset per RFC 7644:
//   - POST /scim/v2/Users  → create + return SCIM User resource
//   - GET  /scim/v2/Users  → list (server-side pagination, no filter for now)
//
// Rate-limited 60 req / 10s per bearer token (spec §3.15).
// Audit-logged via writeCoreAuditLogInTx.

import { NextResponse } from "next/server";
import { withRls } from "@/lib/db";
import { verifyScimBearer } from "@/lib/auth/scim-auth";
import { checkRateLimitWithIp } from "@/lib/rate-limit";
import { jitProvisionTeamMember } from "@/lib/auth/jit-provision";

function scimUserRepresentation(row: {
  id: string;
  email: string;
  name: string | null;
  active: boolean;
}) {
  return {
    schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
    id: row.id,
    userName: row.email,
    name: {
      formatted: row.name ?? row.email,
    },
    emails: [{ value: row.email, primary: true }],
    active: row.active,
    meta: {
      resourceType: "User",
      location: `/scim/v2/Users/${row.id}`,
    },
  };
}

function scimError(status: number, detail: string) {
  return NextResponse.json(
    {
      schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
      detail,
      status: String(status),
    },
    { status, headers: { "content-type": "application/scim+json" } }
  );
}

export async function POST(req: Request) {
  const auth = await verifyScimBearer(req.headers.get("authorization"));
  if (!auth.ok) return scimError(auth.status, auth.error);

  const rate = await checkRateLimitWithIp(`scim:${auth.tokenId}`, 60, 10, 10_000);
  if (!rate.allowed) return scimError(429, "Too many requests");

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return scimError(400, "Invalid JSON body");
  }

  const userName = body.userName as string | undefined;
  const emails = body.emails as Array<{ value?: string; primary?: boolean }> | undefined;
  const nameObj = body.name as { formatted?: string; givenName?: string; familyName?: string } | undefined;
  const email = userName ?? emails?.find((e) => e.primary)?.value ?? emails?.[0]?.value;
  if (!email || !email.includes("@")) {
    return scimError(400, "Missing or invalid email/userName");
  }
  const displayName =
    nameObj?.formatted ??
    [nameObj?.givenName, nameObj?.familyName].filter(Boolean).join(" ").trim() ??
    null;
  const rawGroups = (body.groups as Array<{ display?: string; value?: string }> | undefined) ?? [];
  const idpGroups = rawGroups
    .map((g) => g.display ?? g.value)
    .filter((v): v is string => typeof v === "string" && v.length > 0);

  // Resolve provider config (either SAML or OIDC — use whichever is
  // active, prefer SAML for group mapping). The IdP config is where
  // the group mappings + default role live.
  const providerConfig = await withRls(
    { tenantId: auth.tenantId, userId: null, role: "SUPER_ADMIN" },
    async (tx) => {
      const idp = await tx.tenantIdentityProvider.findFirst({
        where: { tenantId: auth.tenantId, isActive: true },
        orderBy: { kind: "asc" }, // OIDC first alphabetically, then SAML
      });
      return idp;
    }
  );
  const mappings = (providerConfig?.groupMappings as Array<{ idpGroup: string; roleName: string }>) ?? [];
  const defaultRoleName =
    ((providerConfig?.config as Record<string, unknown> | undefined)?.defaultRoleName as string) ?? "Agent";
  const autoApproveSso =
    ((providerConfig?.config as Record<string, unknown> | undefined)?.autoApproveSso as boolean) ?? true; // SCIM defaults to auto-approve

  const result = await withRls(
    { tenantId: auth.tenantId, userId: null, role: "SUPER_ADMIN" },
    (tx) =>
      jitProvisionTeamMember(tx, {
        tenantId: auth.tenantId,
        email,
        name: displayName || null,
        idpGroups,
        groupMappings: mappings,
        defaultRoleName,
        autoApproveSso,
        providerLabel: "scim",
      })
  );
  if (!result.ok) return scimError(409, result.error);

  return NextResponse.json(
    scimUserRepresentation({
      id: result.result.subjectId,
      email: result.result.email,
      name: displayName ?? null,
      active: result.result.lifecycleStatus === "ACTIVE",
    }),
    { status: 201, headers: { "content-type": "application/scim+json" } }
  );
}

export async function GET(req: Request) {
  const auth = await verifyScimBearer(req.headers.get("authorization"));
  if (!auth.ok) return scimError(auth.status, auth.error);

  const rate = await checkRateLimitWithIp(`scim:${auth.tokenId}`, 60, 10, 10_000);
  if (!rate.allowed) return scimError(429, "Too many requests");

  const url = new URL(req.url);
  const startIndex = Math.max(1, Number(url.searchParams.get("startIndex") ?? "1"));
  const count = Math.min(200, Math.max(1, Number(url.searchParams.get("count") ?? "50")));

  const rows = await withRls(
    { tenantId: auth.tenantId, userId: null, role: "SUPER_ADMIN" },
    async (tx) => {
      const [total, page] = await Promise.all([
        tx.teamMember.count({ where: { tenantId: auth.tenantId } }),
        tx.teamMember.findMany({
          where: { tenantId: auth.tenantId },
          orderBy: { createdAt: "asc" },
          skip: startIndex - 1,
          take: count,
        }),
      ]);
      const lifecycles = await tx.teamMemberLifecycle.findMany({
        where: { subjectId: { in: page.map((p) => p.id) } },
      });
      const active = new Map(lifecycles.map((l) => [l.subjectId, l.status === "ACTIVE"]));
      return { total, page: page.map((p) => ({ ...p, active: active.get(p.id) ?? false })) };
    }
  );

  return NextResponse.json(
    {
      schemas: ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
      totalResults: rows.total,
      startIndex,
      itemsPerPage: rows.page.length,
      Resources: rows.page.map((r) =>
        scimUserRepresentation({
          id: r.id,
          email: r.email,
          name: r.name,
          active: r.active,
        })
      ),
    },
    { status: 200, headers: { "content-type": "application/scim+json" } }
  );
}
