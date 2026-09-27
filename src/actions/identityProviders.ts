"use server";

// M6.2/M6.3/M6.7 — TenantIdentityProvider CRUD + group-mapping edits.
//
// The config blob is protocol-specific and lives inside the JSON column;
// server actions here do the shape validation. Secrets (SAML cert, OIDC
// clientSecret) are envelope-encrypted before persist (v2: format from
// M6.1.a) — the raw values never round-trip back to the client on read.

import { z } from "zod";
import { withRls } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { envelopeEncrypt } from "@/core/auth/envelope-crypto";

const groupMappingSchema = z.object({
  idpGroup: z.string().min(1),
  roleName: z.string().min(1),
});

const samlConfigSchema = z.object({
  kind: z.literal("SAML"),
  entityId: z.string().min(1),
  ssoUrl: z.string().url(),
  sloUrl: z.string().url().optional(),
  cert: z.string().min(1),
  wantAssertionsSigned: z.boolean().default(true),
});

const oidcConfigSchema = z.object({
  kind: z.literal("OIDC"),
  issuer: z.string().url(),
  clientId: z.string().min(1),
  clientSecret: z.string().min(1),
  scopes: z.array(z.string()).default(["openid", "profile", "email"]),
});

const upsertSchema = z.object({
  displayName: z.string().min(1).max(80).default("Sign in with SSO"),
  isActive: z.boolean().default(true),
  config: z.discriminatedUnion("kind", [samlConfigSchema, oidcConfigSchema]),
  groupMappings: z.array(groupMappingSchema).default([]),
  defaultRoleName: z.string().default("Agent"),
  autoApproveSso: z.boolean().default(false),
});

type UpsertResult = { ok: true } | { ok: false; error: string };

/**
 * Idempotent by (tenantId, kind) — one SAML provider and one OIDC
 * provider per tenant. Encrypts cert (SAML) or clientSecret (OIDC) via
 * envelope encryption before persist. All other config fields land as
 * plaintext JSON — they're not secret.
 */
export async function upsertIdentityProvider(
  input: z.infer<typeof upsertSchema>
): Promise<UpsertResult> {
  const parsed = upsertSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const session = await requireSession({ minRole: "SUPER_ADMIN" });

  return withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    async (tx) => {
      // Encrypt the protocol's secret field before persist.
      const config = parsed.data.config;
      const persisted: Record<string, unknown> = { ...config };
      if (config.kind === "SAML") {
        persisted.cert = await envelopeEncrypt(tx, session.tenantId, config.cert);
      } else {
        persisted.clientSecret = await envelopeEncrypt(tx, session.tenantId, config.clientSecret);
      }

      await tx.tenantIdentityProvider.upsert({
        where: { tenantId_kind: { tenantId: session.tenantId, kind: config.kind } },
        create: {
          tenantId: session.tenantId,
          kind: config.kind,
          displayName: parsed.data.displayName,
          isActive: parsed.data.isActive,
          config: {
            ...persisted,
            defaultRoleName: parsed.data.defaultRoleName,
            autoApproveSso: parsed.data.autoApproveSso,
          },
          groupMappings: parsed.data.groupMappings,
        },
        update: {
          displayName: parsed.data.displayName,
          isActive: parsed.data.isActive,
          config: {
            ...persisted,
            defaultRoleName: parsed.data.defaultRoleName,
            autoApproveSso: parsed.data.autoApproveSso,
          },
          groupMappings: parsed.data.groupMappings,
        },
      });
      return { ok: true as const };
    }
  );
}

const disableSchema = z.object({ kind: z.enum(["SAML", "OIDC"]) });

export async function disableIdentityProvider(
  input: z.infer<typeof disableSchema>
): Promise<UpsertResult> {
  const parsed = disableSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input." };
  const session = await requireSession({ minRole: "SUPER_ADMIN" });

  await withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    (tx) =>
      tx.tenantIdentityProvider.updateMany({
        where: { tenantId: session.tenantId, kind: parsed.data.kind },
        data: { isActive: false },
      })
  );
  return { ok: true };
}

/**
 * Reads the tenant's IdP config for the admin page. Redacts secret
 * fields — the raw ciphertext never round-trips back to the client
 * (the admin sees "•••" and can only replace, not read).
 */
export async function getIdentityProviders(): Promise<
  Array<{
    kind: "SAML" | "OIDC";
    displayName: string;
    isActive: boolean;
    config: Record<string, unknown>;
    groupMappings: Array<{ idpGroup: string; roleName: string }>;
    defaultRoleName: string;
    autoApproveSso: boolean;
  }>
> {
  const session = await requireSession({ minRole: "SUPER_ADMIN" });
  const rows = await withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    (tx) =>
      tx.tenantIdentityProvider.findMany({
        where: { tenantId: session.tenantId },
        orderBy: { kind: "asc" },
      })
  );
  return rows.map((r) => {
    const rawConfig = r.config as Record<string, unknown>;
    // Redact secret fields.
    const redacted = { ...rawConfig };
    if (r.kind === "SAML") redacted.cert = "•••";
    if (r.kind === "OIDC") redacted.clientSecret = "•••";
    const rawMappings = r.groupMappings as Array<{ idpGroup: string; roleName: string }>;
    return {
      kind: r.kind as "SAML" | "OIDC",
      displayName: r.displayName,
      isActive: r.isActive,
      config: redacted,
      groupMappings: rawMappings ?? [],
      defaultRoleName: (rawConfig.defaultRoleName as string) ?? "Agent",
      autoApproveSso: (rawConfig.autoApproveSso as boolean) ?? false,
    };
  });
}
