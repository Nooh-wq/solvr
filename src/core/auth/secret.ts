// src/core/auth/secret.ts
//
// B3 helper — the HMAC secret used by every JWT this codebase issues.
// Ported verbatim from src/lib/session.ts::getSecret() (Z1.8 shape) so
// no in-flight token gets orphaned during the B6/B7 cutover: sign and
// verify both hash the same `SESSION_SECRET` bytes.
//
// Split into its own module so `tokens.ts` (and any future core-auth
// module) can consume the secret without re-declaring the guards. Same
// guard set as Support's:
//   - required at all times
//   - refuses the dev-placeholder in production
//   - refuses <32 chars in production

/**
 * The dev placeholder shipped in the repo's .env.example. If this
 * value ever reaches a production deploy, anyone who's read the repo
 * can forge session cookies — so refuse to boot with it (or with a
 * too-short secret) when NODE_ENV is production. In dev it's allowed
 * so `npm run dev` works out of the box.
 *
 * Kept byte-identical to src/lib/session.ts's constant so both modules
 * reject the same string during the Support-side migration window.
 */
const DEV_PLACEHOLDER_SECRET =
  "dev-only-secret-change-before-any-real-deployment-7f3a9c2e";

/**
 * Reads and validates the HMAC secret from `process.env.SESSION_SECRET`,
 * returning a `Uint8Array` ready for `jose`.
 *
 * Called lazily (inside sign/verify) rather than at module load so:
 *   - Test suites can set `process.env.SESSION_SECRET` after import.
 *   - Missing-secret failures surface at the first token operation
 *     with a clear stack trace, not at import time inside an unrelated
 *     module.
 *
 * Production guards:
 *   - Refuses the dev placeholder — the repo's baked-in value must be
 *     replaced before any real deploy.
 *   - Refuses secrets shorter than 32 chars — HS256 with <256 bits of
 *     key material is a downgrade in security.
 */
export function getSecret(): Uint8Array {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET is not set");
  if (process.env.NODE_ENV === "production") {
    if (secret === DEV_PLACEHOLDER_SECRET) {
      throw new Error(
        "SESSION_SECRET is still the dev placeholder — set a strong, unique secret before deploying."
      );
    }
    if (secret.length < 32) {
      throw new Error(
        "SESSION_SECRET is too short for production — use at least 32 random characters."
      );
    }
  }
  return new TextEncoder().encode(secret);
}
