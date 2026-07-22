"use server";

// M20 — Compliance & Governance actions.
//
// Admin surface: retention policy (M20.2), HIPAA toggle (M20.6/M20.7),
// BAA download availability.
// Super Admin surface: BYOK configuration (M20.5), crypto-shred.

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withRls } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { actorCols, dualFkForUser } from "@/lib/z1-dual-fk";
import { shredTenantKey } from "@/lib/compliance/byok";

const retentionSchema = z.object({
  retentionTicketsDays: z.number().int().min(1).max(3650).nullable(),
  retentionMessagesDays: z.number().int().min(1).max(3650).nullable(),
  retentionAuditLogsDays: z.number().int().min(1).max(3650).nullable(),
});

/**
 * M20.2 — set the tenant's retention TTL config. The sweep-retention
 * cron reads this and deletes anything older on the nightly tick.
 */
export async function updateRetentionPolicy(input: z.infer<typeof retentionSchema>) {
  const session = await requireSession({ minRole: "ADMIN" });
  const data = retentionSchema.parse(input);
  await withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    async (tx) => {
      await tx.tenant.update({
        where: { id: session.tenantId },
        data: {
          retentionTicketsDays: data.retentionTicketsDays,
          retentionMessagesDays: data.retentionMessagesDays,
          retentionAuditLogsDays: data.retentionAuditLogsDays,
        },
      });
      await tx.auditLog.create({
        data: {
          tenantId: session.tenantId,
          ...actorCols(dualFkForUser(session.subjectId, session.role)),
          action: "RETENTION_POLICY_UPDATE",
          toValue: JSON.stringify(data),
        },
      });
    }
  );
  revalidatePath("/admin/account/compliance");
  return { ok: true as const };
}

/** M20 — toggle HIPAA mode. Downstream: log redaction, BAA availability. */
export async function setHipaaEnabled(enabled: boolean) {
  const session = await requireSession({ minRole: "ADMIN" });
  await withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    async (tx) => {
      await tx.tenant.update({
        where: { id: session.tenantId },
        data: { hipaaEnabled: enabled },
      });
      await tx.auditLog.create({
        data: {
          tenantId: session.tenantId,
          ...actorCols(dualFkForUser(session.subjectId, session.role)),
          action: enabled ? "HIPAA_ENABLE" : "HIPAA_DISABLE",
        },
      });
    }
  );
  revalidatePath("/admin/account/compliance");
  revalidatePath("/trust");
  return { ok: true as const };
}

/**
 * M20.5 — configure BYOK. Requires SUPER_ADMIN because it changes the
 * cryptographic root of trust for the tenant. Passing kmsKeyRef=null
 * downgrades to PLATFORM mode (does NOT re-encrypt anything — the DEK
 * stays put, only the wrapping key changes).
 */
const byokSchema = z.object({
  kmsMode: z.enum(["PLATFORM", "BYOK"]),
  kmsKeyRef: z.string().max(500).nullable(),
});

export async function configureByok(input: z.infer<typeof byokSchema>) {
  const session = await requireSession({ minRole: "SUPER_ADMIN" });
  const data = byokSchema.parse(input);
  if (data.kmsMode === "BYOK" && !data.kmsKeyRef) {
    throw new Error("BYOK mode requires a KMS key reference.");
  }
  await withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    async (tx) => {
      await tx.tenantEncryptionKey.upsert({
        where: { tenantId: session.tenantId },
        create: {
          tenantId: session.tenantId,
          wrappedDek: "PENDING:" + Math.random().toString(36).slice(2),
          kmsMode: data.kmsMode,
          kmsKeyRef: data.kmsKeyRef,
        },
        update: { kmsMode: data.kmsMode, kmsKeyRef: data.kmsKeyRef },
      });
      await tx.auditLog.create({
        data: {
          tenantId: session.tenantId,
          ...actorCols(dualFkForUser(session.subjectId, session.role)),
          action: "BYOK_CONFIGURE",
          toValue: `${data.kmsMode}:${data.kmsKeyRef ?? ""}`,
        },
      });
    }
  );
  revalidatePath("/admin/account/compliance");
  revalidatePath("/trust");
  return { ok: true as const };
}

/**
 * M20.5 — crypto-shred the tenant's key material. Every PHI ciphertext
 * + every M6.1-encrypted field for this tenant becomes unrecoverable.
 * SUPER_ADMIN only (spec §3 "operational discipline"). Records an
 * AuditLog for the pre-shred window; the AuditLog itself may itself
 * later be deleted by retention.
 */
export async function shredTenantEncryptionKey(confirmToken: string) {
  const session = await requireSession({ minRole: "SUPER_ADMIN" });
  if (confirmToken !== "SHRED-I-UNDERSTAND") {
    throw new Error("Refusing to shred: pass the exact confirmToken 'SHRED-I-UNDERSTAND'.");
  }
  await withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    async (tx) => {
      await shredTenantKey(tx, session.tenantId);
      await tx.auditLog.create({
        data: {
          tenantId: session.tenantId,
          ...actorCols(dualFkForUser(session.subjectId, session.role)),
          action: "TENANT_KEY_SHRED",
        },
      });
    }
  );
  revalidatePath("/admin/account/compliance");
  revalidatePath("/trust");
  return { ok: true as const };
}

/**
 * Public read used by the Trust Center. No secrets — flags only.
 */
export async function getComplianceStatus(): Promise<{
  residencyRegion: string;
  hipaaEnabled: boolean;
  kmsMode: "PLATFORM" | "BYOK" | null;
  kmsKeyRef: string | null;
  shreddedAt: string | null;
  retention: {
    tickets: number | null;
    messages: number | null;
    auditLogs: number | null;
  };
}> {
  const session = await requireSession({ minRole: "AGENT" });
  return withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    async (tx) => {
      const t = await tx.tenant.findUnique({
        where: { id: session.tenantId },
        select: {
          residencyRegion: true,
          hipaaEnabled: true,
          retentionTicketsDays: true,
          retentionMessagesDays: true,
          retentionAuditLogsDays: true,
        },
      });
      const key = await tx.tenantEncryptionKey.findUnique({
        where: { tenantId: session.tenantId },
        select: { kmsMode: true, kmsKeyRef: true, shreddedAt: true },
      });
      return {
        residencyRegion: t?.residencyRegion ?? "US",
        hipaaEnabled: !!t?.hipaaEnabled,
        kmsMode: (key?.kmsMode as "PLATFORM" | "BYOK" | undefined) ?? null,
        kmsKeyRef: key?.kmsKeyRef ?? null,
        shreddedAt: key?.shreddedAt?.toISOString() ?? null,
        retention: {
          tickets: t?.retentionTicketsDays ?? null,
          messages: t?.retentionMessagesDays ?? null,
          auditLogs: t?.retentionAuditLogsDays ?? null,
        },
      };
    }
  );
}

/**
 * M20.7 — generate a BAA (Business Associate Agreement) document for
 * download. Text-only stub: the real deliverable is a countersigned PDF
 * from legal, distributed out-of-band. This endpoint gates on HIPAA
 * mode being on and produces a placeholder the admin can share with
 * their compliance team as evidence the product surface exists.
 */
export async function generateBaaText(): Promise<string> {
  const session = await requireSession({ minRole: "ADMIN" });
  const status = await withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    (tx) =>
      tx.tenant.findUnique({
        where: { id: session.tenantId },
        select: { name: true, hipaaEnabled: true },
      })
  );
  if (!status?.hipaaEnabled) {
    throw new Error("BAA is only available for HIPAA-enabled tenants. Enable HIPAA mode first.");
  }
  return [
    `BUSINESS ASSOCIATE AGREEMENT`,
    ``,
    `Between: Solvr (the "Business Associate")`,
    `And: ${status.name} (the "Covered Entity")`,
    ``,
    `This BAA governs the handling of Protected Health Information (PHI) in`,
    `accordance with the HIPAA Privacy Rule (45 CFR Part 164) and the HIPAA`,
    `Security Rule.`,
    ``,
    `1. Permitted uses: Business Associate may use PHI only as necessary to`,
    `   provide the ticketing / support services the parties have contracted.`,
    `2. Safeguards: Business Associate implements administrative, physical,`,
    `   and technical safeguards including per-tenant envelope encryption,`,
    `   field-level encryption for PHI-marked custom fields, and access`,
    `   controls scoped by role.`,
    `3. Subcontractors: Any subcontractor with access to PHI must sign an`,
    `   equivalent BAA.`,
    `4. Reporting: Business Associate will report any Security Incident or`,
    `   Breach within 30 days of discovery.`,
    `5. Termination: On termination, Business Associate will return or destroy`,
    `   all PHI, including via crypto-shred where applicable.`,
    ``,
    `This is a placeholder generated by the product for compliance evidence.`,
    `A countersigned agreement should be obtained from Solvr Legal via your`,
    `account team.`,
  ].join("\n");
}
