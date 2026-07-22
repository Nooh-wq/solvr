// src/core/auth/mfa-crypto.ts
//
// M6.1 — at-rest encryption for TOTP secrets in AuthCredential.mfaSecret.
//
// Format versions:
//   - v1: AES-256-GCM(KEK, plaintext). Direct-KEK encryption. Only ever
//         appears on rows written between the M6.1 initial ship and the
//         M6.1.a envelope migration. Read-only path — no new v1 rows are
//         ever written after M6.1.a.
//   - v2: AES-256-GCM(DEK, plaintext) where DEK is per-tenant, stored
//         wrapped under KEK in tenant_encryption_keys. See envelope-crypto.
//
// v1 → v2 opportunistic rewrap: when a v1 ciphertext is decrypted here,
// callers receive a `rewrapAs` field they can (and should) persist back
// as the tenant's v2 ciphertext. That way legacy rows migrate on their
// next verify without a big-bang backfill script.
//
// v1 decrypt stays available and correct — but no code path writes v1
// anymore. If MFA_SECRET_KEY changes without re-wrap, v1 rows become
// unreadable exactly the same way v2 DEKs do.

import crypto from "node:crypto";
import type { PrismaClient } from "@/generated/prisma";
import { envelopeEncrypt, envelopeDecrypt } from "./envelope-crypto";

const ALGO = "aes-256-gcm";
const IV_BYTES = 12;
const KEY_BYTES = 32;

type TxLike = PrismaClient | Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

function getKek(): Buffer {
  const raw = process.env.MFA_SECRET_KEY;
  if (!raw) {
    throw new Error(
      "MFA_SECRET_KEY is not set. Generate one with `openssl rand -base64 32` and set it in .env."
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

/**
 * Encrypts a TOTP secret for storage. Post-M6.1.a this always produces
 * a `v2:` ciphertext under the tenant's DEK — no new v1 rows are ever
 * written.
 */
export async function encryptSecret(
  tx: TxLike,
  tenantId: string,
  plaintext: string
): Promise<string> {
  return envelopeEncrypt(tx, tenantId, plaintext);
}

/**
 * Decrypts a stored ciphertext. Accepts either format:
 *   - `v2:...` — envelope-decrypted under the tenant's DEK
 *   - `v1:...` — KEK-direct decrypted (legacy rows only)
 *
 * Returns `{ plaintext, rewrapAs }` where `rewrapAs` is:
 *   - null for v2 rows (already in the current format)
 *   - a fresh v2 ciphertext for v1 rows (caller should persist to
 *     migrate the row on next verify)
 *
 * Returns null on any cryptographic failure (unknown version, tampered
 * data, wrong key). Callers collapse this to "verify failed".
 */
export async function decryptSecret(
  tx: TxLike,
  tenantId: string,
  ciphertext: string
): Promise<{ plaintext: string; rewrapAs: string | null } | null> {
  const parts = ciphertext.split(":");
  if (parts.length !== 4) return null;

  if (parts[0] === "v2") {
    const pt = await envelopeDecrypt(tx, tenantId, ciphertext);
    if (pt === null) return null;
    return { plaintext: pt, rewrapAs: null };
  }

  if (parts[0] === "v1") {
    try {
      const iv = Buffer.from(parts[1], "base64");
      const tag = Buffer.from(parts[2], "base64");
      const ct = Buffer.from(parts[3], "base64");
      if (iv.length !== IV_BYTES) return null;
      const kek = getKek();
      const decipher = crypto.createDecipheriv(ALGO, kek, iv);
      decipher.setAuthTag(tag);
      const plaintext = Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
      // Opportunistic rewrap: mint a fresh v2 for the caller to persist.
      const rewrapAs = await envelopeEncrypt(tx, tenantId, plaintext);
      return { plaintext, rewrapAs };
    } catch {
      return null;
    }
  }

  return null;
}
