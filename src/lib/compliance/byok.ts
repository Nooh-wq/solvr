// M20.5 — BYOK (customer-managed KMS keys).
//
// Design:
//   - PLATFORM mode (default): identical to M6.1. KEK from
//     MFA_SECRET_KEY wraps the tenant DEK.
//   - BYOK mode: the tenant's own KMS key wraps the DEK. Unwrapping
//     requires a call to the customer's KMS (AWS KMS, GCP KMS, Vault,
//     etc.) which returns the plaintext DEK for the current operation.
//     If the customer revokes/deletes their KMS key, every ciphertext
//     column encrypted under this DEK becomes unrecoverable — the
//     crypto-shred model (spec §3 diagram).
//
// This module intentionally does NOT ship an AWS SDK client — a
// concrete resolver plugs in at deploy time via BYOK_RESOLVER. In this
// build the "resolver" is a deterministic HMAC-derived KEK per
// kmsKeyRef so the envelope math works end-to-end in dev/CI without a
// real KMS call. Swap for a real KMS resolver in prod by exporting a
// module that implements `ByokResolver` and setting
// BYOK_RESOLVER=path/to/module.
//
// Spec §3 pin — "Do NOT let BYOK be a marketing checkbox without
// operational discipline": the shredTenantKey() action is
// SUPER_ADMIN-gated, writes an AuditLog, sets shreddedAt (not just
// deletes the row so we retain the trail of when the key existed) and
// nulls wrappedDek so any subsequent decrypt attempt returns null.

import crypto from "node:crypto";
import type { PrismaClient } from "@/generated/prisma";

type TxLike = PrismaClient | Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

const KEY_BYTES = 32;

export type ByokResolver = {
  /** Returns a stable 32-byte KEK for the given kmsKeyRef. */
  resolveKek(kmsKeyRef: string): Promise<Buffer>;
};

/**
 * Default dev/CI resolver — derives a stable KEK from
 * HMAC(MFA_SECRET_KEY, "byok:" + kmsKeyRef). In prod, swap this out
 * for a resolver that hits the customer's KMS.
 */
const defaultResolver: ByokResolver = {
  async resolveKek(kmsKeyRef: string): Promise<Buffer> {
    const seed = process.env.MFA_SECRET_KEY ?? "";
    if (!seed) throw new Error("MFA_SECRET_KEY not set — BYOK default resolver requires a seed.");
    const kek = crypto.createHmac("sha256", Buffer.from(seed, "base64")).update("byok:" + kmsKeyRef).digest();
    if (kek.length !== KEY_BYTES) throw new Error("Derived KEK is not 32 bytes.");
    return kek;
  },
};

let activeResolver: ByokResolver = defaultResolver;

/** Prod deployments call this at boot to install a real KMS resolver. */
export function installByokResolver(r: ByokResolver): void {
  activeResolver = r;
}

/** Returns the KEK to use for a tenant, honouring its kmsMode + kmsKeyRef. */
export async function getKekForTenant(
  tx: TxLike,
  tenantId: string
): Promise<{ kek: Buffer; mode: "PLATFORM" | "BYOK"; shredded: boolean } | null> {
  const row = await tx.tenantEncryptionKey.findUnique({
    where: { tenantId },
    select: { kmsMode: true, kmsKeyRef: true, shreddedAt: true },
  });
  if (!row) return null;
  if (row.shreddedAt) return { kek: Buffer.alloc(0), mode: row.kmsMode as "BYOK", shredded: true };
  if (row.kmsMode === "BYOK") {
    if (!row.kmsKeyRef) throw new Error(`BYOK tenant ${tenantId} has no kmsKeyRef configured.`);
    const kek = await activeResolver.resolveKek(row.kmsKeyRef);
    return { kek, mode: "BYOK", shredded: false };
  }
  // PLATFORM — falls through to envelope-crypto.ts's platform KEK.
  return { kek: Buffer.alloc(0), mode: "PLATFORM", shredded: false };
}

/**
 * Crypto-shred a tenant's key material. Irrecoverable — all
 * ciphertexts encrypted under this DEK are permanently unreadable.
 * Callable only from an admin action (server-side) with a SUPER_ADMIN
 * session; the action layer records the AuditLog.
 */
export async function shredTenantKey(tx: TxLike, tenantId: string): Promise<{ shredded: true }> {
  const existing = await tx.tenantEncryptionKey.findUnique({ where: { tenantId } });
  if (!existing) throw new Error(`Tenant ${tenantId} has no encryption key to shred.`);
  await tx.tenantEncryptionKey.update({
    where: { tenantId },
    data: {
      // Overwrite the wrapped DEK with a sentinel so no unwrap attempt
      // can succeed even if MFA_SECRET_KEY is later leaked.
      wrappedDek: "SHREDDED:" + crypto.randomBytes(16).toString("hex"),
      shreddedAt: new Date(),
    },
  });
  return { shredded: true };
}

/** Read the shred status without decrypting — used by the Trust Center. */
export async function isTenantKeyShredded(tx: TxLike, tenantId: string): Promise<boolean> {
  const row = await tx.tenantEncryptionKey.findUnique({
    where: { tenantId },
    select: { shreddedAt: true },
  });
  return !!row?.shreddedAt;
}
