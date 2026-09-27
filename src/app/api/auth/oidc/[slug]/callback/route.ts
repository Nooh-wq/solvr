// M6.3 — OIDC callback. Verifies state, exchanges code for tokens,
// extracts claims, JIT-provisions, mints session.

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { withRls } from "@/lib/db";
import { oidcHandleCallback, type OidcConfig } from "@/lib/auth/oidc";
import { jitProvisionTeamMember, type GroupMapping } from "@/lib/auth/jit-provision";
import { createUserSession } from "@/lib/user-session";
import { recordLoginActivity } from "@/lib/login-activity";
import { createSessionCookie } from "@/lib/session";
import { REDIRECT_BY_ROLE } from "@/lib/redirect-by-role";

function wrapperRoleNameToUserRole(name: string): "CLIENT" | "AGENT" | "ADMIN" | "SUPER_ADMIN" {
  if (name === "Super Admin") return "SUPER_ADMIN";
  if (name === "Admin") return "ADMIN";
  if (name === "Agent") return "AGENT";
  return "AGENT";
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const url = new URL(req.url);
  const origin = `${url.protocol}//${url.host}`;

  const jar = await cookies();
  const codeVerifier = jar.get("oidc_verifier")?.value;
  const expectedState = jar.get("oidc_state")?.value;
  if (!codeVerifier || !expectedState) {
    return new NextResponse("Missing OIDC cookies (expired session or CSRF)", { status: 400 });
  }

  const tenant = await withRls({ tenantId: "", userId: null, role: "SUPER_ADMIN" as const }, async (tx) => {
    const t = await tx.tenant.findFirst({ where: { slug }, select: { id: true } });
    if (!t) return null;
    const idp = await tx.tenantIdentityProvider.findFirst({
      where: { tenantId: t.id, kind: "OIDC", isActive: true },
      select: { config: true, groupMappings: true },
    });
    return t && idp
      ? { tenantId: t.id, config: idp.config as Record<string, unknown>, groupMappings: idp.groupMappings }
      : null;
  }).catch(() => null);
  if (!tenant) return new NextResponse("SSO not configured", { status: 404 });

  const cfg: OidcConfig = {
    issuer: String(tenant.config.issuer),
    clientId: String(tenant.config.clientId),
    clientSecret: String(tenant.config.clientSecret),
    scopes: (tenant.config.scopes as string[] | undefined) ?? ["openid", "profile", "email"],
  };

  const profile = await withRls(
    { tenantId: tenant.tenantId, userId: null, role: "SUPER_ADMIN" as const },
    (tx) => oidcHandleCallback({
      tx,
      tenantId: tenant.tenantId,
      cfg,
      origin,
      slug,
      currentUrl: url,
      expectedState,
      codeVerifier,
    })
  ).catch((e: unknown) => ({ error: e instanceof Error ? e.message : String(e) }));
  if ("error" in profile) {
    return new NextResponse(`OIDC verification failed: ${profile.error}`, { status: 400 });
  }

  const mappings = (tenant.groupMappings as GroupMapping[]) ?? [];
  const defaultRoleName = (tenant.config.defaultRoleName as string) ?? "Agent";
  const autoApproveSso = (tenant.config.autoApproveSso as boolean) ?? false;

  const jit = await withRls(
    { tenantId: tenant.tenantId, userId: null, role: "SUPER_ADMIN" as const },
    (tx) => jitProvisionTeamMember(tx, {
      tenantId: tenant.tenantId,
      email: profile.email,
      name: profile.name,
      idpGroups: profile.groups,
      groupMappings: mappings,
      defaultRoleName,
      autoApproveSso,
      providerLabel: "oidc",
    })
  );
  if (!jit.ok) return new NextResponse(jit.error, { status: 403 });

  if (jit.result.lifecycleStatus === "PENDING") {
    return new NextResponse(
      "Your account is awaiting admin approval. You'll get an email when it's ready.",
      { status: 200, headers: { "content-type": "text/plain" } }
    );
  }

  const sessionId = await createUserSession({
    subjectId: jit.result.subjectId,
    subjectKind: jit.result.subjectKind,
    tenantId: tenant.tenantId,
  });
  await createSessionCookie({
    subjectId: jit.result.subjectId,
    subjectKind: jit.result.subjectKind,
    tenantId: tenant.tenantId,
    sessionId,
  });
  await recordLoginActivity({
    tenantId: tenant.tenantId,
    subjectId: jit.result.subjectId,
    subjectKind: jit.result.subjectKind,
  });

  const role = wrapperRoleNameToUserRole(jit.result.roleName);
  const res = NextResponse.redirect(new URL(REDIRECT_BY_ROLE[role], origin), { status: 302 });
  res.cookies.delete("oidc_verifier");
  res.cookies.delete("oidc_state");
  return res;
}
