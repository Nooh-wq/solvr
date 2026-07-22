// M6.3 — OIDC init endpoint. Builds auth URL, stores state + PKCE
// verifier in signed cookies, redirects to IdP.

import { NextResponse } from "next/server";
import { withRls } from "@/lib/db";
import { oidcBuildAuthorizeUrl, type OidcConfig } from "@/lib/auth/oidc";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const url = new URL(req.url);
  const origin = `${url.protocol}//${url.host}`;

  const tenant = await withRls({ tenantId: "", userId: null, role: "SUPER_ADMIN" as const }, async (tx) => {
    const t = await tx.tenant.findFirst({ where: { slug }, select: { id: true } });
    if (!t) return null;
    const idp = await tx.tenantIdentityProvider.findFirst({
      where: { tenantId: t.id, kind: "OIDC", isActive: true },
      select: { config: true },
    });
    return t && idp ? { tenantId: t.id, config: idp.config as Record<string, unknown> } : null;
  }).catch(() => null);
  if (!tenant) return new NextResponse("SSO not configured", { status: 404 });

  const cfg: OidcConfig = {
    issuer: String(tenant.config.issuer),
    clientId: String(tenant.config.clientId),
    clientSecret: String(tenant.config.clientSecret),
    scopes: (tenant.config.scopes as string[] | undefined) ?? ["openid", "profile", "email"],
  };

  const { url: target, codeVerifier, state } = await withRls(
    { tenantId: tenant.tenantId, userId: null, role: "SUPER_ADMIN" as const },
    (tx) => oidcBuildAuthorizeUrl({ tx, tenantId: tenant.tenantId, cfg, origin, slug })
  );

  const res = NextResponse.redirect(target, { status: 302 });
  const opts = {
    httpOnly: true,
    secure: true,
    sameSite: "lax" as const,
    path: `/api/auth/oidc/${slug}`,
    maxAge: 60 * 10,
  };
  res.cookies.set("oidc_verifier", codeVerifier, opts);
  res.cookies.set("oidc_state", state, opts);
  return res;
}
