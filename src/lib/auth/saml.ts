// src/lib/auth/saml.ts
//
// M6.2 — SAML SP wiring. Wraps @node-saml/node-saml (the maintained fork
// of passport-saml's core). Two operations per request:
//
//   1. Build an AuthnRequest → redirect the user to the IdP
//   2. Verify the incoming SAML response at the ACS callback →
//      extract email / name / groups → hand off to jit-provision.
//
// The load-bearing security properties (XML signature verification,
// signature-wrapping-attack defense, algorithm allow-list) live inside
// @node-saml/node-saml. This module's job is to bind that library to
// per-tenant config from TenantIdentityProvider.

import { SAML } from "@node-saml/node-saml";
import { envelopeDecrypt } from "@/core/auth/envelope-crypto";
import type { PrismaClient } from "@/generated/prisma";

type TxLike = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

export type SamlConfig = {
  entityId: string; // IdP's entity id
  ssoUrl: string;
  cert: string; // ciphertext (envelope-encrypted PEM)
  wantAssertionsSigned?: boolean;
};

/**
 * Resolve the tenant's SAML SP endpoints from the request's origin.
 * ACS URL is stable per-tenant: `/api/auth/saml/{slug}/acs`. Include
 * the slug so the IdP posts back to the right tenant path — otherwise
 * a shared ACS would need SAML RelayState to disambiguate, which some
 * IdPs mangle.
 */
export function samlEndpointsForTenant(origin: string, slug: string) {
  return {
    // SP metadata + AuthnRequest issuer
    entityId: `${origin}/api/auth/saml/${slug}/metadata`,
    // ACS (assertion consumer service)
    acsUrl: `${origin}/api/auth/saml/${slug}/acs`,
    // Metadata document
    metadataUrl: `${origin}/api/auth/saml/${slug}/metadata`,
  };
}

async function buildSaml(
  tx: TxLike,
  tenantId: string,
  cfg: SamlConfig,
  origin: string,
  slug: string
): Promise<SAML> {
  const certPem = await envelopeDecrypt(tx, tenantId, cfg.cert);
  if (!certPem) throw new Error("SAML_CERT_UNAVAILABLE");
  const endpoints = samlEndpointsForTenant(origin, slug);
  return new SAML({
    entryPoint: cfg.ssoUrl,
    issuer: endpoints.entityId,
    callbackUrl: endpoints.acsUrl,
    idpCert: certPem,
    // Hard-pinned to the modern algorithms — SHA-1 rejected outright.
    signatureAlgorithm: "sha256",
    digestAlgorithm: "sha256",
    // The library defaults to true; being explicit locks in the desired
    // property for reviewers.
    wantAssertionsSigned: cfg.wantAssertionsSigned ?? true,
    // We handle audience via the entityId claim already; skip the audit
    // restriction check would be unsafe — leave defaults in place.
    identifierFormat: "urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress",
    // Never accept unsigned responses.
    wantAuthnResponseSigned: true,
  });
}

/**
 * Generates the SAML AuthnRequest and returns a URL the client can
 * redirect to. Includes RelayState = short-lived nonce for CSRF.
 */
export async function samlBuildAuthorizeUrl(args: {
  tx: TxLike;
  tenantId: string;
  cfg: SamlConfig;
  origin: string;
  slug: string;
  relayState: string;
}): Promise<string> {
  const saml = await buildSaml(args.tx, args.tenantId, args.cfg, args.origin, args.slug);
  const url = await saml.getAuthorizeUrlAsync(args.relayState, args.origin, {});
  return url;
}

/**
 * Verify an ACS callback (the SAMLResponse form field). Returns the
 * extracted profile on success, throws on any failure. The library
 * itself enforces signature + algorithm + audience + expiry — we only
 * project the response into a plain shape here.
 */
export async function samlHandleAcs(args: {
  tx: TxLike;
  tenantId: string;
  cfg: SamlConfig;
  origin: string;
  slug: string;
  formBody: Record<string, string>;
}): Promise<{
  email: string;
  name: string | null;
  groups: string[];
}> {
  const saml = await buildSaml(args.tx, args.tenantId, args.cfg, args.origin, args.slug);
  const parsed = await saml.validatePostResponseAsync(args.formBody);
  const profile = parsed.profile;
  if (!profile) throw new Error("SAML_NO_PROFILE");
  // NameID is typically the email; if not, look in attribute claims.
  const attributes = (profile.attributes as Record<string, unknown>) ?? {};
  const email =
    (typeof profile.nameID === "string" && profile.nameID.includes("@")
      ? profile.nameID
      : (attributes.email as string | undefined) ??
        (attributes.mail as string | undefined) ??
        (attributes["http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress"] as string | undefined));
  if (!email) throw new Error("SAML_NO_EMAIL_CLAIM");
  const nameClaim =
    (attributes.displayName as string | undefined) ??
    (attributes.name as string | undefined) ??
    (attributes["http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name"] as string | undefined) ??
    null;
  // Groups: SAML wire format varies wildly. Common shapes:
  //   - `groups`: string[] or single string
  //   - `http://schemas.xmlsoap.org/claims/Group`: string[] or single string
  // Normalize to string[].
  const rawGroups =
    attributes.groups ??
    attributes.Groups ??
    attributes["http://schemas.xmlsoap.org/claims/Group"] ??
    [];
  const groups = Array.isArray(rawGroups)
    ? (rawGroups as string[]).map(String)
    : rawGroups
      ? [String(rawGroups)]
      : [];
  return { email, name: nameClaim, groups };
}
