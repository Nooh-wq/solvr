import crypto from "node:crypto";

/**
 * Guest ticket links (see actions/guest.ts) need to be revocable — unlike
 * the stateless JWTs used for sessions/password-reset, the raw token must be
 * checked against a server-side row (TicketGuest) that can be marked
 * revoked at any time. That lookup needs a tenantId to run through the
 * normal RLS-scoped withRls() the same as every other query, but a guest
 * arrives with nothing but a URL — no session, no host-resolved tenant.
 *
 * So the raw token embeds the tenantId as a plain prefix
 * (`${tenantId}_${secret}`) purely to bootstrap that first tenant-scoped
 * lookup; the actual authorization is the sha256 hash of the WHOLE token
 * (prefix included) matching TicketGuest.tokenHash; tampering with the
 * tenantId prefix alone invalidates the hash just like tampering with the
 * secret would. cuids (used for tenantId) never contain "_", so splitting on
 * the first "_" is unambiguous.
 */
const SECRET_BYTES = 32;

export function createGuestToken(tenantId: string): { raw: string; tokenHash: string } {
  const secret = crypto.randomBytes(SECRET_BYTES).toString("hex");
  const raw = `${tenantId}_${secret}`;
  return { raw, tokenHash: hashGuestToken(raw) };
}

export function hashGuestToken(raw: string): string {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

export function parseGuestToken(raw: string): { tenantId: string; tokenHash: string } | null {
  const idx = raw.indexOf("_");
  if (idx <= 0) return null;
  const tenantId = raw.slice(0, idx);
  if (!/^[a-z0-9]+$/i.test(tenantId)) return null;
  return { tenantId, tokenHash: hashGuestToken(raw) };
}
