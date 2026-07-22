// M6.2 — SP metadata document served to the IdP admin during setup.
// The IdP admin gives the Stralis admin their metadata URL/document,
// then registers Stralis's metadata (this endpoint) in their IdP.
//
// This is a static-shape XML document — no per-request state.

import { NextResponse } from "next/server";
import { withRls } from "@/lib/db";
import { samlEndpointsForTenant } from "@/lib/auth/saml";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const url = new URL(req.url);
  const origin = `${url.protocol}//${url.host}`;
  const endpoints = samlEndpointsForTenant(origin, slug);

  // Resolve the tenant from slug for the display name in the metadata.
  const tenant = await withRls({ tenantId: "", userId: null, role: "SUPER_ADMIN" as const }, async (tx) => {
    return tx.tenant.findFirst({
      where: { slug },
      select: { id: true, name: true },
    });
  }).catch(() => null);
  if (!tenant) {
    return new NextResponse("Tenant not found", { status: 404 });
  }

  // Minimal spec-compliant SAML 2.0 SP metadata. No signing cert on
  // our side (we don't sign AuthnRequests today); the IdP posts to ACS
  // and its signature is what we verify.
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<EntityDescriptor xmlns="urn:oasis:names:tc:SAML:2.0:metadata" entityID="${endpoints.entityId}">
  <SPSSODescriptor AuthnRequestsSigned="false" WantAssertionsSigned="true" protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol">
    <NameIDFormat>urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress</NameIDFormat>
    <AssertionConsumerService index="0" isDefault="true" Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST" Location="${endpoints.acsUrl}"/>
  </SPSSODescriptor>
</EntityDescriptor>`;

  return new NextResponse(xml, {
    headers: { "content-type": "application/xml; charset=utf-8" },
  });
}
