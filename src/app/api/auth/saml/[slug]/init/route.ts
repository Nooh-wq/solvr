// M6.2 — SAML init endpoint. Client hits this URL, we build an
// AuthnRequest, redirect the browser to the IdP's SSO URL. IdP posts
// the SAMLResponse back to /api/auth/saml/{slug}/acs.

import { NextResponse } from "next/server";
import { withRls } from "@/lib/db";
import { samlBuildAuthorizeUrl, type SamlConfig } from "@/lib/auth/saml";
import { randomBytes } from "node:crypto";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const url = new URL(req.url);
  const origin = `${url.protocol}//${url.host}`;

  const tenant = await withRls({ tenantId: "", userId: null, role: "SUPER_ADMIN" as const }, async (tx) => {
    const t = await tx.tenant.findFirst({
      where: { slug },
      select: { id: true },
    });
    if (!t) return null;
    const idp = await tx.tenantIdentityProvider.findFirst({
      where: { tenantId: t.id, kind: "SAML", isActive: true },
      select: { config: true },
    });
    return t && idp ? { tenantId: t.id, config: idp.config as Record<string, unknown> } : null;
  }).catch(() => null);
  if (!tenant) {
    return new NextResponse("SSO not configured for this tenant", { status: 404 });
  }

  const cfg: SamlConfig = {
    entityId: String(tenant.config.entityId),
    ssoUrl: String(tenant.config.ssoUrl),
    cert: String(tenant.config.cert),
    wantAssertionsSigned: tenant.config.wantAssertionsSigned !== false,
  };

  // RelayState = short random nonce; stored in a signed cookie for the
  // ACS callback to check. Blocks IdP-initiated response replay from
  // arbitrary origins.
  const relayState = randomBytes(24).toString("base64url");

  const target = await withRls(
    { tenantId: tenant.tenantId, userId: null, role: "SUPER_ADMIN" as const },
    (tx) => samlBuildAuthorizeUrl({
      tx,
      tenantId: tenant.tenantId,
      cfg,
      origin,
      slug,
      relayState,
    })
  );

  const res = NextResponse.redirect(target, { status: 302 });
  res.cookies.set("saml_relay", relayState, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: `/api/auth/saml/${slug}`,
    maxAge: 60 * 10, // 10 min — plenty for IdP round-trip
  });
  return res;
}
