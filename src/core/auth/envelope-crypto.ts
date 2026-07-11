// src/core/auth/envelope-crypto.ts
//
// M6.1.a — per-tenant envelope encryption.
//
// Architecture:
//   - KEK (Key Encryption Key): a single 32-byte value from MFA_SECRET_KEY.
//     Never encrypts data directly; only used to wrap DEKs.
//   - DEK (Data Encryption Key): a fresh 32-byte value per tenant. Created
//     lazily on first encryption. Stored in tenant_encryption_keys, wrapped
//     under KEK via AES-256-GCM.
//   - Data encryption: AES-256-GCM(DEK, plaintext). DEK is decrypted from
//     the wrapped form on read.
//
// Why envelope (vs. single-key AES-GCM on the payload directly):
//   - Blast radius: a stolen DB dump alone reveals nothing without KEK;
//     a stolen KEK alone reveals nothing without the DB. Both compromise
//     is required.
//   - Per-tenant rotation: rewriting one tenant's DEK is a one-row update
//     followed by a re-encrypt of that tenant's secrets. No cross-tenant
//     blast on rotation.
//   - Future rotation of KEK becomes a bounded operation: re-wrap every
//     DEK once; the data ciphertexts stay untouched.
//   - Cross-tenant leakage: a bug that reads the wrong tenant's row
//     silently fails at the DEK-decrypt step (wrong tenant → wrong wrapped
//     DEK → wrong plaintext DEK → GCM tag mismatch → null). Single-key
//     mode would happily decrypt any tenant's ciphertext with the shared
//     key.
//
// Wire format for the ciphertext column:
//   `v2:<data_iv_b64>:<data_tag_b64>:<data_ct_b64>`
//   (the tenant id is implicit — the caller decides which DEK to use)
//
// Wire format for the wrapped DEK (`tenant_encryption_keys.wrappedDek`):
//   `<dek_iv_b64>:<dek_tag_b64>:<dek_ct_b64>`
//   (no version prefix — this is an internal storage format keyed to the
//   single KEK; a KEK rotation would rewrap in place.)
//
// See mfa-crypto.ts for the v1 legacy read path — v1 ciphertexts (produced
// by M6.1 pre-envelope) fall through to a KEK-direct decrypt and get
// rewrapped opportunistically on the next verify.

import crypto from "node:crypto";
import type { PrismaClient } from "@/generated/prisma";

const ALGO = "aes-256-gcm";
const IV_BYTES = 12;
const KEY_BYTES = 32;

type TxLike = PrismaClient | Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

function getKek(): Buffer {
  const raw = process.env.MFA_SECRET_KEY;
  if (!raw) {
    throw new Error(
      "MFA_SECRET_KEY (KEK) is not set. Generate one with `openssl rand -base64 32` and set it in .env."
    );
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== KEY_BYTES) {
    throw new Error(
      `MFA_SECRET_KEY must decode to exactly ${KEY_BYTES} bytes (got ${key.length}).`
    );
  }
  return key;
}

function wrapDek(dek: Buffer): string {
  const kek = getKek();
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGO, kek, iv);
  const ct = Buffer.concat([cipher.update(dek), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}:${tag.toString("base64")}:${ct.toString("base64")}`;
}

function unwrapDek(wrapped: string): Buffer | null {
  try {
    const parts = wrapped.split(":");
    if (parts.length !== 3) return null;
    const iv = Buffer.from(parts[0], "base64");
    const tag = Buffer.from(parts[1], "base64");
    const ct = Buffer.from(parts[2], "base64");
    if (iv.length !== IV_BYTES) return null;
    const kek = getKek();
    const decipher = crypto.createDecipheriv(ALGO, kek, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]);
  } catch {
    return null;
  }
}

/**
 * Returns the plaintext DEK for a tenant, creating a fresh one if the
 * tenant has never had a key before. The wrapped form is what lives in
 * tenant_encryption_keys; the plaintext is materialized only in memory
 * on this function's stack frame and the caller's cipher operation.
 *
 * Concurrent create-race is handled via the `@@unique` on tenantId in
 * the schema — two racing callers, one create wins, the other gets a
 * unique-violation and re-reads.
 */
export async function getOrCreateTenantDek(tx: TxLike, tenantId: string): Promise<Buffer> {
  const existing = await tx.tenantEncryptionKey.findUnique({
    where: { tenantId },
    select: { wrappedDek: true },
  });
  if (existing) {
    const dek = unwrapDek(existing.wrappedDek);
    if (!dek) {
      throw new Error(
        `Tenant ${tenantId} encryption key is corrupt or KEK has changed. Manual rewrap required.`
      );
    }
    return dek;
  }
  const dek = crypto.randomBytes(KEY_BYTES);
  const wrapped = wrapDek(dek);
  try {
    await tx.tenantEncryptionKey.create({
      data: { tenantId, wrappedDek: wrapped },
    });
  } catch {
    // Concurrent create race — re-read and return the winner's key.
    const winner = await tx.tenantEncryptionKey.findUnique({
      where: { tenantId },
      select: { wrappedDek: true },
    });
    const winnerDek = winner ? unwrapDek(winner.wrappedDek) : null;
    if (!winnerDek) throw new Error(`Tenant ${tenantId} DEK race unresolved.`);
    return winnerDek;
  }
  return dek;
}

/**
 * Encrypt plaintext under the tenant's DEK. Produces a `v2:` ciphertext
 * suitable for storage in any per-tenant secret column (mfaSecret today,
 * SAML certs / SCIM tokens once M6.2 lands).
 */
export async function envelopeEncrypt(
  tx: TxLike,
  tenantId: string,
  plaintext: string
): Promise<string> {
  const dek = await getOrCreateTenantDek(tx, tenantId);
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGO, dek, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v2:${iv.toString("base64")}:${tag.toString("base64")}:${ct.toString("base64")}`;
}

/**
 * Decrypt a `v2:` ciphertext under the tenant's DEK. Returns null on any
 * cryptographic failure so callers can collapse "no secret" and "corrupt
 * or wrong-tenant secret" to a single guest-side error.
 */
export async function envelopeDecrypt(
  tx: TxLike,
  tenantId: string,
  ciphertext: string
): Promise<string | null> {
  try {
    const parts = ciphertext.split(":");
    if (parts.length !== 4 || parts[0] !== "v2") return null;
    const iv = Buffer.from(parts[1], "base64");
    const tag = Buffer.from(parts[2], "base64");
    const ct = Buffer.from(parts[3], "base64");
    if (iv.length !== IV_BYTES) return null;
    const dek = await getOrCreateTenantDek(tx, tenantId);
    const decipher = crypto.createDecipheriv(ALGO, dek, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}
