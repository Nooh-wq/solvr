// src/lib/auth/oidc.ts
//
// M6.3 — OIDC SP wiring via openid-client v6. Two operations per
// request:
//
//   1. Build the authorization URL → redirect user to IdP
//   2. Verify the callback code exchange → extract claims → JIT
//
// The library discovers the IdP's endpoints via /.well-known/openid-
// configuration from the issuer URL; we cache that discovery result
// per-tenant to avoid a round-trip per login.

import * as oidc from "openid-client";
import { envelopeDecrypt } from "@/core/auth/envelope-crypto";
import type { PrismaClient } from "@/generated/prisma";

type TxLike = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

export type OidcConfig = {
  issuer: string;
  clientId: string;
  clientSecret: string; // ciphertext (envelope-encrypted)
  scopes?: string[];
};

// Simple in-process discovery cache. TTL 1h. Discovery documents change
// rarely; a hot cache lets us handle bursts of logins without hitting
// the IdP's discovery endpoint each time.
const discoveryCache = new Map<string, { config: oidc.Configuration; expiresAt: number }>();

function oidcRedirectUri(origin: string, slug: string): string {
  return `${origin}/api/auth/oidc/${slug}/callback`;
}

async function getConfiguration(cfg: OidcConfig, clientSecretPlain: string): Promise<oidc.Configuration> {
  const key = `${cfg.issuer}::${cfg.clientId}`;
  const cached = discoveryCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.config;
  const config = await oidc.discovery(new URL(cfg.issuer), cfg.clientId, clientSecretPlain);
  discoveryCache.set(key, { config, expiresAt: Date.now() + 60 * 60 * 1000 });
  return config;
}

/**
 * Build the authorization URL for redirect. Returns URL + code_verifier
 * + state — caller stores the last two in cookies for the callback to
 * check.
 */
export async function oidcBuildAuthorizeUrl(args: {
  tx: TxLike;
  tenantId: string;
  cfg: OidcConfig;
  origin: string;
  slug: string;
}): Promise<{ url: string; codeVerifier: string; state: string }> {
  const clientSecret = await envelopeDecrypt(args.tx, args.tenantId, args.cfg.clientSecret);
  if (!clientSecret) throw new Error("OIDC_CLIENT_SECRET_UNAVAILABLE");
  const config = await getConfiguration(args.cfg, clientSecret);

  const state = oidc.randomState();
  const codeVerifier = oidc.randomPKCECodeVerifier();
  const codeChallenge = await oidc.calculatePKCECodeChallenge(codeVerifier);

  const params: Record<string, string> = {
    redirect_uri: oidcRedirectUri(args.origin, args.slug),
    scope: (args.cfg.scopes ?? ["openid", "profile", "email"]).join(" "),
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    state,
  };

  const url = oidc.buildAuthorizationUrl(config, params).href;
  return { url, codeVerifier, state };
}

/**
 * Exchange the callback code for tokens, verify the id_token, and
 * project the claims into our common { email, name, groups } shape.
 */
export async function oidcHandleCallback(args: {
  tx: TxLike;
  tenantId: string;
  cfg: OidcConfig;
  origin: string;
  slug: string;
  currentUrl: URL;
  expectedState: string;
  codeVerifier: string;
}): Promise<{ email: string; name: string | null; groups: string[] }> {
  const clientSecret = await envelopeDecrypt(args.tx, args.tenantId, args.cfg.clientSecret);
  if (!clientSecret) throw new Error("OIDC_CLIENT_SECRET_UNAVAILABLE");
  const config = await getConfiguration(args.cfg, clientSecret);

  const tokens = await oidc.authorizationCodeGrant(config, args.currentUrl, {
    pkceCodeVerifier: args.codeVerifier,
    expectedState: args.expectedState,
  });

  const claims = tokens.claims();
  if (!claims) throw new Error("OIDC_NO_CLAIMS");
  const email = (claims.email as string | undefined) ?? "";
  if (!email) throw new Error("OIDC_NO_EMAIL_CLAIM");
  const name =
    (claims.name as string | undefined) ??
    (claims.given_name as string | undefined) ??
    null;
  // Groups: OIDC providers vary. Common shapes: `groups`, `roles`.
  const rawGroups = (claims.groups as unknown) ?? (claims.roles as unknown) ?? [];
  const groups = Array.isArray(rawGroups) ? (rawGroups as string[]).map(String) : rawGroups ? [String(rawGroups)] : [];
  return { email, name, groups };
}
