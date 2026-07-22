"use server";

// M19 — App Marketplace / TenantIntegration actions.
//
// The marketplace catalog itself is a code-side registry (see
// src/lib/marketplace/apps.ts) — this file only manages per-tenant
// installs. Credentials are envelope-encrypted at write time and NEVER
// round-tripped to the client for display (same pattern as M12's
// ChannelConfig).

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withRls } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { envelopeEncrypt, envelopeDecrypt } from "@/core/auth/envelope-crypto";
import { actorCols, dualFkForUser } from "@/lib/z1-dual-fk";
import { getMarketplaceApp, listMarketplaceApps } from "@/lib/marketplace/apps";
import type { Integration, IntegrationContext } from "@/lib/marketplace/types";

const installSchema = z.object({
  id: z.string().min(1).optional(),
  appKey: z.string().min(1).max(60),
  displayName: z.string().min(1).max(80),
  isActive: z.boolean().default(true),
  // Empty string values mean "leave existing" on update.
  credentials: z.record(z.string(), z.string().max(2000)),
  meta: z.record(z.string(), z.string().max(500)),
});

export type MarketplaceAppDto = {
  key: string;
  name: string;
  tagline: string;
  category: string;
  authMode: string;
  credentialFields: { key: string; label: string; helpText?: string; isSecret: boolean }[];
  metaFields: { key: string; label: string; helpText?: string; placeholder?: string }[];
};

export type InstalledIntegrationDto = {
  id: string;
  appKey: string;
  appName: string;
  displayName: string;
  isActive: boolean;
  metaJson: Record<string, unknown>;
  lastTestedAt: string | null;
  lastTestOk: boolean | null;
  lastTestMessage: string | null;
  updatedAt: string;
};

function toAppDto(a: Integration): MarketplaceAppDto {
  return {
    key: a.key,
    name: a.name,
    tagline: a.tagline,
    category: a.category,
    authMode: a.authMode,
    credentialFields: a.credentialFields.map((f) => ({
      key: f.key,
      label: f.label,
      helpText: f.helpText,
      isSecret: f.isSecret,
    })),
    metaFields: (a.metaFields ?? []).map((f) => ({
      key: f.key,
      label: f.label,
      helpText: f.helpText,
      placeholder: f.placeholder,
    })),
  };
}

export async function listCatalog(): Promise<MarketplaceAppDto[]> {
  await requireSession({ minRole: "ADMIN" });
  return listMarketplaceApps().map(toAppDto);
}

export async function getCatalogApp(key: string): Promise<MarketplaceAppDto | null> {
  await requireSession({ minRole: "ADMIN" });
  const a = getMarketplaceApp(key);
  return a ? toAppDto(a) : null;
}

export async function listInstalledIntegrations(): Promise<InstalledIntegrationDto[]> {
  const session = await requireSession({ minRole: "ADMIN" });
  return withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    async (tx) => {
      const rows = await tx.tenantIntegration.findMany({
        where: { tenantId: session.tenantId },
        orderBy: [{ appKey: "asc" }, { displayName: "asc" }],
      });
      return rows.map((r) => {
        const app = getMarketplaceApp(r.appKey);
        return {
          id: r.id,
          appKey: r.appKey,
          appName: app?.name ?? r.appKey,
          displayName: r.displayName,
          isActive: r.isActive,
          metaJson: (r.metaJson as Record<string, unknown>) ?? {},
          lastTestedAt: r.lastTestedAt?.toISOString() ?? null,
          lastTestOk: r.lastTestOk,
          lastTestMessage: r.lastTestMessage,
          updatedAt: r.updatedAt.toISOString(),
        };
      });
    }
  );
}

/**
 * Returns installed integrations trimmed to just what a picker needs
 * (id + display name + app key). Used by the Escalation Path editor's
 * INTEGRATION destination and by any future rule action that targets an
 * integration.
 */
export async function listInstalledIntegrationsForPicker(): Promise<
  { id: string; appKey: string; appName: string; displayName: string }[]
> {
  const session = await requireSession({ minRole: "AGENT" });
  return withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    async (tx) => {
      const rows = await tx.tenantIntegration.findMany({
        where: { tenantId: session.tenantId, isActive: true },
        select: { id: true, appKey: true, displayName: true },
        orderBy: { displayName: "asc" },
      });
      return rows.map((r) => ({
        id: r.id,
        appKey: r.appKey,
        appName: getMarketplaceApp(r.appKey)?.name ?? r.appKey,
        displayName: r.displayName,
      }));
    }
  );
}

/**
 * Install (create) or update a TenantIntegration.
 *
 * On update, empty-string cred values are treated as "no change" so an
 * admin can rotate a single credential without retyping every secret —
 * same pattern as M12's ChannelConfig upsert.
 */
export async function upsertIntegration(input: z.infer<typeof installSchema>) {
  const session = await requireSession({ minRole: "ADMIN" });
  const data = installSchema.parse(input);
  const app = getMarketplaceApp(data.appKey);
  if (!app) throw new Error(`Unknown marketplace app: ${data.appKey}`);

  return withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    async (tx) => {
      const existing = data.id
        ? await tx.tenantIntegration.findFirst({
            where: { id: data.id, tenantId: session.tenantId },
          })
        : null;

      let credsToStore: Record<string, string> = data.credentials;
      if (existing) {
        const priorPlain = await envelopeDecrypt(tx, session.tenantId, existing.configEnc);
        const prior = priorPlain ? (JSON.parse(priorPlain) as Record<string, string>) : {};
        const merged: Record<string, string> = { ...prior };
        for (const [k, v] of Object.entries(data.credentials)) {
          if (v !== "") merged[k] = v;
        }
        credsToStore = merged;
      }

      // Validate every declared credential field is present after the
      // merge (fail-closed against "empty install" installs). If a
      // credential is optional in a future integration, that's a per-
      // field flag on the catalog entry — for now, everything declared
      // is required.
      for (const f of app.credentialFields) {
        if (!credsToStore[f.key] || credsToStore[f.key] === "") {
          throw new Error(`Missing credential: ${f.label}`);
        }
      }

      const configEnc = await envelopeEncrypt(
        tx,
        session.tenantId,
        JSON.stringify(credsToStore)
      );

      // Run test() before persist so the admin sees the failure inline
      // rather than having to click "Test" after saving.
      const ctx: IntegrationContext = {
        tenantId: session.tenantId,
        credentials: credsToStore,
        meta: data.meta,
      };
      let testOk: boolean | null = null;
      let testMessage: string | null = null;
      try {
        const t = await app.test(ctx);
        testOk = t.ok;
        testMessage = t.message ?? null;
      } catch (e) {
        testOk = false;
        testMessage = e instanceof Error ? e.message : String(e);
      }

      const row = existing
        ? await tx.tenantIntegration.update({
            where: { id: existing.id },
            data: {
              displayName: data.displayName,
              isActive: data.isActive,
              configEnc,
              metaJson: data.meta,
              lastTestedAt: new Date(),
              lastTestOk: testOk,
              lastTestMessage: testMessage,
            },
          })
        : await tx.tenantIntegration.create({
            data: {
              tenantId: session.tenantId,
              appKey: data.appKey,
              displayName: data.displayName,
              isActive: data.isActive,
              configEnc,
              metaJson: data.meta,
              lastTestedAt: new Date(),
              lastTestOk: testOk,
              lastTestMessage: testMessage,
              installedByTeamMemberId: dualFkForUser(session.subjectId, session.role).teamMemberId,
            },
          });

      await tx.auditLog.create({
        data: {
          tenantId: session.tenantId,
          ...actorCols(dualFkForUser(session.subjectId, session.role)),
          action: existing ? "INTEGRATION_UPDATE" : "INTEGRATION_INSTALL",
          toValue: `${row.appKey}:${row.displayName}`,
        },
      });
      revalidatePath("/admin/apps/marketplace");
      revalidatePath("/admin/apps/installed");
      return { ok: true as const, id: row.id, testOk, testMessage };
    }
  );
}

/** Re-run the connector's test() and cache the result. */
export async function testIntegration(id: string) {
  const session = await requireSession({ minRole: "ADMIN" });
  return withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    async (tx) => {
      const row = await tx.tenantIntegration.findFirst({
        where: { id, tenantId: session.tenantId },
      });
      if (!row) throw new Error("Integration not found.");
      const app = getMarketplaceApp(row.appKey);
      if (!app) throw new Error(`Unknown marketplace app: ${row.appKey}`);
      const plain = await envelopeDecrypt(tx, session.tenantId, row.configEnc);
      const creds = plain ? (JSON.parse(plain) as Record<string, string>) : {};
      let ok = false;
      let message: string | null = null;
      try {
        const t = await app.test({
          tenantId: session.tenantId,
          credentials: creds,
          meta: (row.metaJson as Record<string, unknown>) ?? {},
        });
        ok = t.ok;
        message = t.message ?? null;
      } catch (e) {
        ok = false;
        message = e instanceof Error ? e.message : String(e);
      }
      await tx.tenantIntegration.update({
        where: { id: row.id },
        data: { lastTestedAt: new Date(), lastTestOk: ok, lastTestMessage: message },
      });
      revalidatePath("/admin/apps/installed");
      return { ok, message };
    }
  );
}

/**
 * Uninstall guard (spec §3): don't let an uninstall silently break
 * active M1 rules. If an EscalationPath references this integration by
 * id, block the delete and return the referring paths so the UI can ask
 * the admin to unlink first.
 */
export async function uninstallIntegration(id: string) {
  const session = await requireSession({ minRole: "ADMIN" });
  return withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    async (tx) => {
      const row = await tx.tenantIntegration.findFirst({
        where: { id, tenantId: session.tenantId },
      });
      if (!row) throw new Error("Integration not found.");

      // Escalation paths reference integrations via destConfig.integrationId.
      // Scanning JSON is fine — the row count is small (dozens per tenant).
      const paths = await tx.escalationPath.findMany({
        where: { tenantId: session.tenantId, destKind: "INTEGRATION" },
        select: { id: true, label: true, destConfig: true },
      });
      const blocking = paths.filter((p) => {
        const cfg = p.destConfig as { integrationId?: string } | null;
        return cfg?.integrationId === row.id;
      });
      if (blocking.length > 0) {
        throw new Error(
          `In use by ${blocking.length} escalation path${blocking.length === 1 ? "" : "s"}: ${blocking
            .map((p) => p.label)
            .join(", ")}. Unlink or delete these paths first.`
        );
      }

      await tx.tenantIntegration.delete({ where: { id: row.id } });
      await tx.auditLog.create({
        data: {
          tenantId: session.tenantId,
          ...actorCols(dualFkForUser(session.subjectId, session.role)),
          action: "INTEGRATION_UNINSTALL",
          fromValue: `${row.appKey}:${row.displayName}`,
        },
      });
      revalidatePath("/admin/apps/installed");
      return { ok: true as const };
    }
  );
}

/**
 * Agent-invoked from the ticket-detail "Send to <app>" button. Wraps
 * executeIntegration so the ticket page can call it directly.
 */
export async function runIntegrationOnTicket(input: {
  integrationId: string;
  ticketId: string;
  note?: string;
}) {
  const session = await requireSession({ minRole: "AGENT" });
  const schema = z.object({
    integrationId: z.string().min(1),
    ticketId: z.string().min(1),
    note: z.string().max(2000).optional(),
  });
  const data = schema.parse(input);
  const { executeIntegration } = await import("@/lib/marketplace/executor");
  const result = await executeIntegration({
    session: { tenantId: session.tenantId, subjectId: session.subjectId, role: session.role },
    integrationId: data.integrationId,
    ticketId: data.ticketId,
    note: data.note,
    source: "button",
  });
  revalidatePath(`/agent/tickets/${data.ticketId}`);
  return { ok: true as const, ...result };
}

/**
 * List a ticket's integration links — used by the ticket-detail
 * "Linked apps" panel. Read-only.
 */
export async function listTicketIntegrationLinks(ticketId: string) {
  const session = await requireSession({ minRole: "AGENT" });
  return withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    async (tx) => {
      const rows = await tx.ticketIntegrationLink.findMany({
        where: { tenantId: session.tenantId, ticketId },
        include: { integration: { select: { appKey: true, displayName: true } } },
        orderBy: { createdAt: "desc" },
      });
      return rows.map((r) => ({
        id: r.id,
        externalKey: r.externalKey,
        externalUrl: r.externalUrl,
        externalTitle: r.externalTitle,
        appKey: r.integration.appKey,
        appName: getMarketplaceApp(r.integration.appKey)?.name ?? r.integration.appKey,
        integrationDisplayName: r.integration.displayName,
        createdAt: r.createdAt.toISOString(),
      }));
    }
  );
}
