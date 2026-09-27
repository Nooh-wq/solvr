// M6.2 — SAML ACS callback. IdP posts the SAMLResponse form field here.
// We verify it (signature + algorithm + audience + expiry — all inside
// @node-saml/node-saml), extract email/name/groups, JIT-provision, then
// mint the session cookie.

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { withRls } from "@/lib/db";
import { samlHandleAcs, type SamlConfig } from "@/lib/auth/saml";
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

export async function POST(
  req: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const url = new URL(req.url);
  const origin = `${url.protocol}//${url.host}`;

  // Read form body (SAMLResponse + RelayState).
  const form = await req.formData();
  const samlResponse = form.get("SAMLResponse");
  const relayState = form.get("RelayState");
  if (typeof samlResponse !== "string") {
    return new NextResponse("Missing SAMLResponse", { status: 400 });
  }

  // RelayState check — must match the cookie set at init time.
  const jar = await cookies();
  const cookieState = jar.get("saml_relay")?.value;
  if (!cookieState || cookieState !== relayState) {
    return new NextResponse("Invalid RelayState (possible CSRF or expired session)", { status: 400 });
  }

  const tenant = await withRls({ tenantId: "", userId: null, role: "SUPER_ADMIN" as const }, async (tx) => {
    const t = await tx.tenant.findFirst({
      where: { slug },
      select: { id: true },
    });
    if (!t) return null;
    const idp = await tx.tenantIdentityProvider.findFirst({
      where: { tenantId: t.id, kind: "SAML", isActive: true },
      select: { config: true, groupMappings: true },
    });
    return t && idp ? { tenantId: t.id, config: idp.config as Record<string, unknown>, groupMappings: idp.groupMappings } : null;
  }).catch(() => null);
  if (!tenant) return new NextResponse("SSO not configured", { status: 404 });

  const cfg: SamlConfig = {
    entityId: String(tenant.config.entityId),
    ssoUrl: String(tenant.config.ssoUrl),
    cert: String(tenant.config.cert),
    wantAssertionsSigned: tenant.config.wantAssertionsSigned !== false,
  };

  const profile = await withRls(
    { tenantId: tenant.tenantId, userId: null, role: "SUPER_ADMIN" as const },
    (tx) => samlHandleAcs({
      tx,
      tenantId: tenant.tenantId,
      cfg,
      origin,
      slug,
      formBody: { SAMLResponse: samlResponse, RelayState: typeof relayState === "string" ? relayState : "" },
    })
  ).catch((e: unknown) => ({ error: e instanceof Error ? e.message : String(e) }));
  if ("error" in profile) {
    return new NextResponse(`SAML verification failed: ${profile.error}`, { status: 400 });
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
      providerLabel: "saml",
    })
  );
  if (!jit.ok) {
    return new NextResponse(jit.error, { status: 403 });
  }

  if (jit.result.lifecycleStatus === "PENDING") {
    return new NextResponse(
      "Your account is awaiting admin approval. You'll get an email when it's ready.",
      { status: 200, headers: { "content-type": "text/plain" } }
    );
  }

  // Mint session.
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

  // Clear the relay cookie.
  const role = wrapperRoleNameToUserRole(jit.result.roleName);
  const redirectTo = REDIRECT_BY_ROLE[role];
  const res = NextResponse.redirect(new URL(redirectTo, origin), { status: 302 });
  res.cookies.delete("saml_relay");
  return res;
}
