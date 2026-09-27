// M19 — App Marketplace shared types + Integration interface.
//
// Every marketplace app implements Integration. The registry
// (src/lib/marketplace/apps.ts) is the platform-wide catalog — spec §2
// says "marketplace catalog is platform-wide, not per-tenant", so
// there's no MarketplaceApp table. A tenant *installs* an entry, which
// materialises a TenantIntegration row (envelope-encrypted config).

import type { PrismaClient } from "@/generated/prisma";

/** A ticket + integration link created by execute(). */
export type ExecuteResult = {
  externalKey: string;
  externalUrl: string;
  externalTitle?: string;
};

/** Loosely-typed context to keep this module import-cheap. */
export type IntegrationContext = {
  tenantId: string;
  // Plain JSON — already envelope-decrypted upstream by callSite.
  credentials: Record<string, string>;
  // Non-secret metadata (project key, workspace name, etc.).
  meta: Record<string, unknown>;
};

/** Shared connector interface — spec §3 "shared interface" pin. */
export type Integration = {
  /** Catalog key — must match the registry entry. */
  key: string;
  /** Human name — the marketplace card title. */
  name: string;
  /** Short marketplace-card blurb (< 120 chars). */
  tagline: string;
  /** Category badge on the card. */
  category: "Communication" | "Developer" | "Business" | "MSP";
  /** Auth mode. "api_key" is the default; OAuth apps are noted here. */
  authMode: "api_key" | "oauth" | "webhook_url";
  /** Fields the admin install form should ask for. */
  credentialFields: CredentialField[];
  /**
   * Optional non-secret metadata fields (target project key, default
   * channel, etc.) — kept out of the encrypted blob so the admin UI
   * can render them without a decrypt.
   */
  metaFields?: MetaField[];
  /**
   * Round-trip probe used by the admin "Installed" list and by
   * upsertIntegration on save. Failure just records lastTestOk=false;
   * never throws upstream.
   */
  test(ctx: IntegrationContext): Promise<{ ok: boolean; message?: string }>;
  /**
   * Perform the integration's primary write action against a Stralis
   * ticket — e.g. create a Jira issue for it, post to a Slack channel.
   * The runtime records the returned link on TicketIntegrationLink.
   */
  execute(
    ctx: IntegrationContext,
    args: { ticket: TicketBrief; note?: string }
  ): Promise<ExecuteResult>;
  /**
   * OPTIONAL — inbound webhook handler for two-way integrations. Left
   * unimplemented in M19.2/.3/.4 (all outbound-only); the interface
   * stub exists so a future integration can wire it up without a
   * schema change.
   */
  webhook?: (
    ctx: IntegrationContext,
    args: { body: unknown; headers: Record<string, string> }
  ) => Promise<void>;
};

export type CredentialField = {
  key: string;
  label: string;
  helpText?: string;
  isSecret: boolean;
};

export type MetaField = {
  key: string;
  label: string;
  helpText?: string;
  placeholder?: string;
};

export type TicketBrief = {
  id: string;
  reference: string;
  subject: string;
  description: string;
  priority: string;
  status: string;
  url: string;
};

export type PrismaTx = Omit<
  PrismaClient,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>;
