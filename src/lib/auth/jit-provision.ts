// src/core/auth/jit-provision.ts
//
// M6.2/M6.3/M6.5 shared JIT provisioning. Given an IdP-authenticated
// subject (email + display name + list of IdP group names), materialize
// or update a Support-side TeamMember + AuthCredential + Lifecycle,
// then hand back the subjectId + role for session issuance.
//
// Called from three surfaces:
//   - SAML ACS callback (src/app/api/auth/saml/[slug]/acs)
//   - OIDC token-exchange callback (src/app/api/auth/oidc/[slug]/callback)
//   - SCIM POST/PATCH /Users (src/app/api/scim/v2/Users)
//
// Group mapping resolution (M6.7):
//   groupMappings is an array of `{ idpGroup, roleName }` pairs. First
//   IdP group that has a mapping wins. If none of the user's groups
//   match, we fall back to the default role — the tenant admin picks
//   this in the IdP config, typically "Agent" for narrow least-privilege.
//
// JIT approval:
//   Auto-approve if a Super Admin has flipped `autoApproveSso: true` in
//   the tenant IdP config (per the M6 spec §3 "DO NOT let SSO bypass the
//   registration approval gate unless the tenant explicitly configures
//   auto-approve"). Otherwise land as PENDING and file the same
//   admin-notify path as email/password self-registration.

import type { PrismaClient } from "@/generated/prisma";
import { writeCoreAuditLogInTx } from "@/lib/shared-platform/audit";
import { randomUUID } from "node:crypto";

type TxLike = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

export type GroupMapping = { idpGroup: string; roleName: string };

export type JitInput = {
  tenantId: string;
  email: string;
  name: string | null;
  idpGroups: string[];
  groupMappings: GroupMapping[];
  defaultRoleName: string;
  autoApproveSso: boolean;
  /**
   * Free-form provider name for the audit log — e.g. "saml:okta" or
   * "oidc:google". No behavior depends on this.
   */
  providerLabel: string;
};

export type JitOutput = {
  subjectId: string;
  subjectKind: "TEAM_MEMBER";
  email: string;
  roleName: string;
  lifecycleStatus: "ACTIVE" | "PENDING";
};

/**
 * Resolves an IdP group list to a Stralis role name using the tenant's
 * mapping table. First mapping match wins (order matters — the admin
 * can put more-specific mappings first). Falls back to defaultRoleName
 * when no group matches.
 */
export function resolveRoleFromGroups(
  idpGroups: string[],
  mappings: GroupMapping[],
  defaultRoleName: string
): string {
  for (const g of idpGroups) {
    for (const m of mappings) {
      if (m.idpGroup === g) return m.roleName;
    }
  }
  return defaultRoleName;
}

/**
 * Provisions or updates a TeamMember from IdP attributes. Runs inside
 * the caller's transaction (SAML/OIDC/SCIM decide the RLS context).
 *
 * If the email already exists as a TeamMember: update name + role from
 * the IdP (source of truth), don't touch AuthCredential.
 *
 * If the email already exists as an EndUser: bail — a user cannot
 * simultaneously be a client and staff. The IdP admin needs to
 * consciously convert them (out of scope for JIT).
 *
 * If no user with this email: create TeamMember + AuthCredential (empty
 * password — SSO users cannot email/password log in) + Lifecycle.
 */
export async function jitProvisionTeamMember(
  tx: TxLike,
  input: JitInput
): Promise<{ ok: true; result: JitOutput } | { ok: false; error: string }> {
  // Resolve the role row for the derived role name.
  const roleName = resolveRoleFromGroups(input.idpGroups, input.groupMappings, input.defaultRoleName);
  const role = await tx.role.findFirst({
    where: { tenantId: input.tenantId, name: roleName },
    select: { id: true, name: true },
  });
  if (!role) {
    return {
      ok: false,
      error: `Group mapping resolved role "${roleName}" but that Role does not exist in this tenant.`,
    };
  }

  // Reject if an EndUser already holds this email.
  const existingEndUser = await tx.endUser.findFirst({
    where: { tenantId: input.tenantId, email: input.email },
    select: { id: true },
  });
  if (existingEndUser) {
    return {
      ok: false,
      error: `${input.email} is registered as a customer. An admin must convert the account before staff sign-in works.`,
    };
  }

  const existingTm = await tx.teamMember.findFirst({
    where: { tenantId: input.tenantId, email: input.email },
    select: { id: true, roleId: true, name: true },
  });

  if (existingTm) {
    // Update-in-place from IdP source-of-truth. Only touch fields the
    // IdP actually claims (name + role). Don't overwrite manual admin
    // edits to fields the IdP doesn't emit.
    const patch: { name?: string; roleId?: string } = {};
    if (input.name && input.name !== existingTm.name) patch.name = input.name;
    if (existingTm.roleId !== role.id) patch.roleId = role.id;
    if (Object.keys(patch).length > 0) {
      await tx.teamMember.update({ where: { id: existingTm.id }, data: patch });
      await writeCoreAuditLogInTx(
        tx,
        { tenantId: input.tenantId, actor: null },
        {
          action: "UPDATE",
          resourceType: "TeamMember",
          resourceId: existingTm.id,
          toValue: { ...patch, jitSource: input.providerLabel },
        }
      );
    }
    // Ensure lifecycle is ACTIVE — an SSO login on a PENDING/INVITED
    // row should activate it (the IdP is the identity source of truth).
    await tx.teamMemberLifecycle.upsert({
      where: { subjectId: existingTm.id },
      create: { subjectId: existingTm.id, tenantId: input.tenantId, status: "ACTIVE", approvedAt: new Date() },
      update: { status: "ACTIVE", approvedAt: new Date() },
    });
    return {
      ok: true,
      result: {
        subjectId: existingTm.id,
        subjectKind: "TEAM_MEMBER",
        email: input.email,
        roleName: role.name,
        lifecycleStatus: "ACTIVE",
      },
    };
  }

  // Fresh JIT provision. TeamMember + AuthCredential (empty passwordHash
  // — SSO-only user) + Lifecycle.
  const subjectId = randomUUID();
  const nextStatus = input.autoApproveSso ? "ACTIVE" : "PENDING";
  const approvedAt = input.autoApproveSso ? new Date() : null;

  await tx.teamMember.create({
    data: {
      id: subjectId,
      tenantId: input.tenantId,
      email: input.email,
      name: input.name,
      roleId: role.id,
    },
  });
  // Empty passwordHash means email/password login is impossible for
  // this user. The bcrypt.compare in login() will fail immediately on
  // an empty hash. If the tenant later disables SSO and wants this user
  // to have password auth, admin sets a password via the invite flow.
  await tx.authCredential.create({
    data: {
      tenantId: input.tenantId,
      subjectTeamMemberId: subjectId,
      passwordHash: "",
    },
  });
  await tx.teamMemberLifecycle.create({
    data: { subjectId, tenantId: input.tenantId, status: nextStatus, approvedAt },
  });
  await writeCoreAuditLogInTx(
    tx,
    { tenantId: input.tenantId, actor: null },
    {
      action: "CREATE",
      resourceType: "TeamMember",
      resourceId: subjectId,
      toValue: {
        email: input.email,
        name: input.name,
        roleId: role.id,
        jitSource: input.providerLabel,
        autoApproved: input.autoApproveSso,
      },
    }
  );

  return {
    ok: true,
    result: {
      subjectId,
      subjectKind: "TEAM_MEMBER",
      email: input.email,
      roleName: role.name,
      lifecycleStatus: nextStatus,
    },
  };
}
