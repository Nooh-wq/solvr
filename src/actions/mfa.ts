"use server";

// M6.1 — TOTP 2FA server actions. Enrollment flow (begin → confirm),
// disable flow, and the internal verifyTotpCode() consumed by the split
// login path in actions/auth.ts.
//
// Backup codes are the recovery path — 8 issued at enroll, shown once,
// stored as bcrypt hashes, single-use. If the user loses BOTH device
// and codes, that's a Super Admin unlock ticket via the promote /
// impersonate path (M6.1 explicitly does not add an email-based
// recovery link — that would defeat the second factor).

import { z } from "zod";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { TOTP, Secret } from "otpauth";
import QRCode from "qrcode";
import { withRls } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { roleToSubjectKind } from "@/lib/z1-dual-fk";
import { encryptSecret, decryptSecret } from "@/core/auth/mfa-crypto";
// M6.1.a — decryptSecret now returns { plaintext, rewrapAs } to support
// opportunistic v1 → v2 rewrap. Sites that verify a decrypted secret
// persist rewrapAs when non-null.
import { signPurposeToken, verifyPurposeToken } from "@/core/auth/tokens";
import { getCurrentTenant } from "@/lib/current-tenant";

const TOTP_ISSUER = "Stralis Support";
const TOTP_ALGO = "SHA1"; // RFC 6238 default — what Google Authenticator, 1Password, Authy all default to
const TOTP_DIGITS = 6;
const TOTP_PERIOD = 30;
const BACKUP_CODE_COUNT = 8;

function subjectColumn(kind: "END_USER" | "TEAM_MEMBER"): "subjectEndUserId" | "subjectTeamMemberId" {
  return kind === "END_USER" ? "subjectEndUserId" : "subjectTeamMemberId";
}

function newTotp(secret: Secret, label: string): TOTP {
  return new TOTP({
    issuer: TOTP_ISSUER,
    label,
    algorithm: TOTP_ALGO,
    digits: TOTP_DIGITS,
    period: TOTP_PERIOD,
    secret,
  });
}

/**
 * Generates BACKUP_CODE_COUNT random 10-character codes formatted as
 * `xxxxx-xxxxx`. Alphabet excludes visually-ambiguous chars (0/O, 1/I/l).
 * These are the plaintext values shown to the user exactly once; only
 * bcrypt hashes are persisted.
 */
function generateBackupCodes(): string[] {
  const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
  const codes: string[] = [];
  for (let i = 0; i < BACKUP_CODE_COUNT; i++) {
    let raw = "";
    const bytes = crypto.randomBytes(10);
    for (let j = 0; j < 10; j++) {
      raw += ALPHABET[bytes[j] % ALPHABET.length];
    }
    codes.push(`${raw.slice(0, 5)}-${raw.slice(5)}`);
  }
  return codes;
}

type BeginEnrollmentResult =
  | { ok: false; error: string }
  | {
      ok: true;
      otpauthUri: string;
      qrDataUri: string;
      backupCodes: string[];
    };

/**
 * Step 1 of enrollment: mints a fresh TOTP secret, stores its ciphertext
 * in mfaSecret, generates backup codes and stores their bcrypt hashes.
 * Does NOT set mfaEnabledAt — that only happens when confirmTotpEnrollment
 * verifies a valid code, proving the user actually scanned the QR.
 *
 * If the user already has 2FA enabled, this refuses — the disable flow
 * must run first (password + code double-check). Re-running enrollment
 * mid-flight (mfaSecret set but mfaEnabledAt still null) simply overwrites
 * the pending secret with a fresh one.
 */
export async function beginTotpEnrollment(): Promise<BeginEnrollmentResult> {
  const session = await requireSession();
  const subjectField = subjectColumn(roleToSubjectKind(session.role));

  const secret = new Secret({ size: 20 }); // 160 bits — RFC 6238 recommendation
  const backupCodes = generateBackupCodes();
  const backupCodesHash = await Promise.all(
    backupCodes.map((c) => bcrypt.hash(c, 10))
  );

  const result = await withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    async (tx) => {
      const cred = await tx.authCredential.findFirst({
        where: { tenantId: session.tenantId, [subjectField]: session.subjectId },
        select: { id: true, mfaEnabledAt: true },
      });
      if (!cred) return { ok: false as const, error: "No credential record." };
      if (cred.mfaEnabledAt) {
        return {
          ok: false as const,
          error: "2FA is already enabled. Disable it first to re-enroll.",
        };
      }
      const encrypted = await encryptSecret(tx, session.tenantId, secret.base32);
      await tx.authCredential.update({
        where: { id: cred.id },
        data: { mfaSecret: encrypted, mfaBackupCodesHash: backupCodesHash },
      });
      return { ok: true as const, email: session.email };
    }
  );

  if (!result.ok) return result;

  const totp = newTotp(secret, result.email ?? session.subjectId);
  const otpauthUri = totp.toString();
  const qrDataUri = await QRCode.toDataURL(otpauthUri, {
    margin: 1,
    width: 240,
  });
  return { ok: true, otpauthUri, qrDataUri, backupCodes };
}

const confirmSchema = z.object({ code: z.string().min(6).max(8) });

/**
 * Step 2 of enrollment: verifies the user typed a valid TOTP code from
 * the authenticator app they just scanned. On success, mfaEnabledAt is
 * set (locking in the enrollment). On failure, mfaSecret is wiped so
 * the user must restart cleanly — no partial state.
 */
export async function confirmTotpEnrollment(
  input: z.infer<typeof confirmSchema>
): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = confirmSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid code." };
  const session = await requireSession();
  const subjectField = subjectColumn(roleToSubjectKind(session.role));

  return withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    async (tx) => {
      const cred = await tx.authCredential.findFirst({
        where: { tenantId: session.tenantId, [subjectField]: session.subjectId },
        select: { id: true, mfaSecret: true, mfaEnabledAt: true },
      });
      if (!cred?.mfaSecret) {
        return { ok: false as const, error: "No enrollment in progress. Start over." };
      }
      if (cred.mfaEnabledAt) {
        return { ok: false as const, error: "2FA is already enabled." };
      }
      const decrypted = await decryptSecret(tx, session.tenantId, cred.mfaSecret);
      if (!decrypted) {
        // Corrupt ciphertext — wipe and force restart.
        await tx.authCredential.update({
          where: { id: cred.id },
          data: { mfaSecret: null, mfaBackupCodesHash: [] },
        });
        return { ok: false as const, error: "Enrollment corrupt. Start over." };
      }
      const totp = newTotp(Secret.fromBase32(decrypted.plaintext), session.email ?? session.subjectId);
      // window: 1 → accept ±30s clock drift.
      const delta = totp.validate({ token: parsed.data.code, window: 1 });
      if (delta === null) {
        // Wrong code → wipe pending secret so the user restarts fresh.
        await tx.authCredential.update({
          where: { id: cred.id },
          data: { mfaSecret: null, mfaBackupCodesHash: [] },
        });
        return { ok: false as const, error: "Incorrect code. Enrollment cleared — start over." };
      }
      // On success: set mfaEnabledAt AND persist the rewrapped ciphertext
      // if we decrypted a legacy v1 row (rewrapAs). Pre-M6.1.a rows can't
      // exist during initial enrollment, but keep the write to make the
      // path symmetric with the verify sites below.
      await tx.authCredential.update({
        where: { id: cred.id },
        data: {
          mfaEnabledAt: new Date(),
          ...(decrypted.rewrapAs ? { mfaSecret: decrypted.rewrapAs } : {}),
        },
      });
      return { ok: true as const };
    }
  );
}

const disableSchema = z.object({
  currentPassword: z.string().min(1),
  code: z.string().min(6).max(8),
});

/**
 * Password + TOTP double-check disable. Both must succeed together —
 * password alone would let a shoulder-surfer disable 2FA on a device
 * the target is briefly logged in on; code alone would let anyone with
 * momentary device access disable it silently.
 */
export async function disableTotp(
  input: z.infer<typeof disableSchema>
): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = disableSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input." };
  const session = await requireSession();
  const subjectField = subjectColumn(roleToSubjectKind(session.role));

  return withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    async (tx) => {
      const cred = await tx.authCredential.findFirst({
        where: { tenantId: session.tenantId, [subjectField]: session.subjectId },
        select: {
          id: true,
          passwordHash: true,
          mfaSecret: true,
          mfaEnabledAt: true,
        },
      });
      if (!cred?.mfaEnabledAt || !cred.mfaSecret) {
        return { ok: false as const, error: "2FA is not enabled." };
      }
      const passwordOk = await bcrypt.compare(parsed.data.currentPassword, cred.passwordHash);
      if (!passwordOk) return { ok: false as const, error: "Incorrect password." };

      const decrypted = await decryptSecret(tx, session.tenantId, cred.mfaSecret);
      if (!decrypted) return { ok: false as const, error: "Cannot verify 2FA — contact support." };
      const totp = newTotp(Secret.fromBase32(decrypted.plaintext), session.email ?? session.subjectId);
      const delta = totp.validate({ token: parsed.data.code, window: 1 });
      if (delta === null) return { ok: false as const, error: "Incorrect code." };
      // Disable path wipes the secret anyway — no need to persist the
      // rewrap. The `decrypted.rewrapAs` is deliberately unused here.

      await tx.authCredential.update({
        where: { id: cred.id },
        data: {
          mfaSecret: null,
          mfaEnabledAt: null,
          mfaBackupCodesHash: [],
        },
      });
      return { ok: true as const };
    }
  );
}

/**
 * Internal helper for actions/auth.ts's split login flow. Attempts TOTP
 * first, then falls through to backup-code consumption. Returns:
 *   - true  → code accepted, side effects (backup-code consumption) done
 *   - false → neither TOTP nor any backup code matched
 *
 * Callers must have already verified the subject's password. Runs
 * under a SUPER_ADMIN RLS context because it's called from the login
 * path where no session exists yet — the challenge token is what
 * proves the caller has legitimate business here.
 */
export async function verifyMfaCode(args: {
  subjectId: string;
  subjectKind: "END_USER" | "TEAM_MEMBER";
  tenantId: string;
  email: string;
  code: string;
}): Promise<boolean> {
  const subjectField = subjectColumn(args.subjectKind);

  return withRls(
    { tenantId: args.tenantId, userId: args.subjectId, role: "SUPER_ADMIN" },
    async (tx) => {
      const cred = await tx.authCredential.findFirst({
        where: { tenantId: args.tenantId, [subjectField]: args.subjectId },
        select: {
          id: true,
          mfaSecret: true,
          mfaEnabledAt: true,
          mfaBackupCodesHash: true,
        },
      });
      if (!cred?.mfaEnabledAt || !cred.mfaSecret) return false;

      const decrypted = await decryptSecret(tx, args.tenantId, cred.mfaSecret);
      if (decrypted) {
        const totp = newTotp(Secret.fromBase32(decrypted.plaintext), args.email);
        const delta = totp.validate({ token: args.code, window: 1 });
        if (delta !== null) {
          // Opportunistic v1 → v2 rewrap on successful verify. Legacy
          // rows migrate to the envelope format on their next login.
          if (decrypted.rewrapAs) {
            await tx.authCredential.update({
              where: { id: cred.id },
              data: { mfaSecret: decrypted.rewrapAs },
            });
          }
          return true;
        }
      }

      // TOTP miss → try backup codes. Sequential compare (bcrypt is slow
      // by design; 8 checks worst case = well under the login rate-limit
      // budget). On match, splice out that hash so it can't be reused.
      for (let i = 0; i < cred.mfaBackupCodesHash.length; i++) {
        const hash = cred.mfaBackupCodesHash[i];
        // Normalise: lowercase and strip hyphens so the user's copy-paste
        // is forgiving. Codes were generated lowercase; still normalise
        // both sides for safety.
        const normalised = args.code.toLowerCase().replace(/[^a-z0-9]/g, "");
        // Backup codes were stored as `xxxxx-xxxxx` (lowercase with
        // hyphen). Try both raw input and re-hyphenated form so users
        // pasting either shape work.
        const hyphenated =
          normalised.length === 10
            ? `${normalised.slice(0, 5)}-${normalised.slice(5)}`
            : normalised;
        const match =
          (await bcrypt.compare(hyphenated, hash)) ||
          (await bcrypt.compare(normalised, hash));
        if (match) {
          const remaining = cred.mfaBackupCodesHash.filter((_, j) => j !== i);
          await tx.authCredential.update({
            where: { id: cred.id },
            data: { mfaBackupCodesHash: remaining },
          });
          return true;
        }
      }
      return false;
    }
  );
}

/** Called by actions/auth.ts login() when password lands + mfaEnabledAt is set. */
export async function issueMfaChallengeToken(args: {
  subjectId: string;
  subjectKind: "END_USER" | "TEAM_MEMBER";
  tenantId: string;
}): Promise<string> {
  return signPurposeToken("mfa-challenge", args);
}

/** Called by actions/auth.ts completeMfaLogin() to unpack the challenge. */
export async function verifyMfaChallengeToken(token: string) {
  return verifyPurposeToken(token, "mfa-challenge");
}

// -------------------------------------------------------------------
// M6.1.b — forced-enrollment surface (token-authed, no session yet).
// The user just typed a valid password on a tenant with enforceMfa=true.
// Login() minted them a 15-min "mfa-enrollment" token; these two actions
// let them enroll without a session, since the whole point of enforcement
// is that no session is issued until they enroll.
// -------------------------------------------------------------------

const enrollmentSchema = z.object({ enrollmentToken: z.string().min(1) });

type ForcedBeginResult =
  | { ok: false; error: string }
  | {
      ok: true;
      otpauthUri: string;
      qrDataUri: string;
      backupCodes: string[];
    };

export async function beginForcedTotpEnrollment(
  input: z.infer<typeof enrollmentSchema>
): Promise<ForcedBeginResult> {
  const parsed = enrollmentSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid enrollment session." };
  const payload = await verifyPurposeToken(parsed.data.enrollmentToken, "mfa-enrollment");
  if (!payload) return { ok: false, error: "This enrollment session has expired." };

  const subjectField = subjectColumn(payload.subjectKind);
  const secret = new Secret({ size: 20 });
  const backupCodes = generateBackupCodes();
  const backupCodesHash = await Promise.all(backupCodes.map((c) => bcrypt.hash(c, 10)));

  const result = await withRls(
    { tenantId: payload.tenantId, userId: payload.subjectId, role: "SUPER_ADMIN" },
    async (tx) => {
      const cred = await tx.authCredential.findFirst({
        where: { tenantId: payload.tenantId, [subjectField]: payload.subjectId },
        select: { id: true, mfaEnabledAt: true },
      });
      if (!cred) return { ok: false as const, error: "No credential record." };
      // If the user managed to enroll via the normal flow between login
      // and hitting this page, don't wipe their state.
      if (cred.mfaEnabledAt) {
        return { ok: false as const, error: "2FA is already enabled. Sign in again." };
      }
      // Resolve the subject's email for the QR label.
      const subject =
        payload.subjectKind === "TEAM_MEMBER"
          ? await tx.teamMember.findFirst({
              where: { id: payload.subjectId, tenantId: payload.tenantId },
              select: { email: true },
            })
          : await tx.endUser.findFirst({
              where: { id: payload.subjectId, tenantId: payload.tenantId },
              select: { email: true },
            });
      const encrypted = await encryptSecret(tx, payload.tenantId, secret.base32);
      await tx.authCredential.update({
        where: { id: cred.id },
        data: { mfaSecret: encrypted, mfaBackupCodesHash: backupCodesHash },
      });
      return { ok: true as const, email: subject?.email ?? payload.subjectId };
    }
  );

  if (!result.ok) return result;
  const totp = newTotp(secret, result.email);
  const otpauthUri = totp.toString();
  const qrDataUri = await QRCode.toDataURL(otpauthUri, { margin: 1, width: 240 });
  return { ok: true, otpauthUri, qrDataUri, backupCodes };
}

const confirmForcedSchema = z.object({
  enrollmentToken: z.string().min(1),
  code: z.string().min(6).max(8),
});

/**
 * Confirms forced enrollment and hands control back to auth.ts to mint
 * the session. This action ONLY sets mfaEnabledAt on the credential — the
 * session issuance happens in actions/auth.ts's completeForcedEnrollment
 * so all session-issuance-plus-login-activity lives in one file.
 */
export async function confirmForcedTotpEnrollment(
  input: z.infer<typeof confirmForcedSchema>
): Promise<{ ok: true; subjectId: string; subjectKind: "END_USER" | "TEAM_MEMBER"; tenantId: string } | { ok: false; error: string }> {
  const parsed = confirmForcedSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input." };

  const payload = await verifyPurposeToken(parsed.data.enrollmentToken, "mfa-enrollment");
  if (!payload) return { ok: false, error: "This enrollment session has expired." };
  const subjectField = subjectColumn(payload.subjectKind);

  return withRls(
    { tenantId: payload.tenantId, userId: payload.subjectId, role: "SUPER_ADMIN" },
    async (tx) => {
      const cred = await tx.authCredential.findFirst({
        where: { tenantId: payload.tenantId, [subjectField]: payload.subjectId },
        select: { id: true, mfaSecret: true, mfaEnabledAt: true },
      });
      if (!cred?.mfaSecret) {
        return { ok: false as const, error: "No enrollment in progress. Start over." };
      }
      if (cred.mfaEnabledAt) {
        return {
          ok: true as const,
          subjectId: payload.subjectId,
          subjectKind: payload.subjectKind,
          tenantId: payload.tenantId,
        };
      }
      const decrypted = await decryptSecret(tx, payload.tenantId, cred.mfaSecret);
      if (!decrypted) {
        await tx.authCredential.update({
          where: { id: cred.id },
          data: { mfaSecret: null, mfaBackupCodesHash: [] },
        });
        return { ok: false as const, error: "Enrollment corrupt. Start over." };
      }
      // Resolve email for the TOTP label — needed for label consistency
      // with the QR the user scanned.
      const subject =
        payload.subjectKind === "TEAM_MEMBER"
          ? await tx.teamMember.findFirst({
              where: { id: payload.subjectId, tenantId: payload.tenantId },
              select: { email: true },
            })
          : await tx.endUser.findFirst({
              where: { id: payload.subjectId, tenantId: payload.tenantId },
              select: { email: true },
            });
      const totp = newTotp(Secret.fromBase32(decrypted.plaintext), subject?.email ?? payload.subjectId);
      const delta = totp.validate({ token: parsed.data.code, window: 1 });
      if (delta === null) {
        await tx.authCredential.update({
          where: { id: cred.id },
          data: { mfaSecret: null, mfaBackupCodesHash: [] },
        });
        return { ok: false as const, error: "Incorrect code. Enrollment cleared — sign in again to restart." };
      }
      await tx.authCredential.update({
        where: { id: cred.id },
        data: { mfaEnabledAt: new Date() },
      });
      return {
        ok: true as const,
        subjectId: payload.subjectId,
        subjectKind: payload.subjectKind,
        tenantId: payload.tenantId,
      };
    }
  );
}

/**
 * Returns the acting subject's 2FA state for the Security tab.
 * Deliberately does NOT return the ciphertext or backup-code hashes —
 * a client-side reveal path is a defect, not a feature.
 */
export async function getMyMfaState(): Promise<{
  enabled: boolean;
  enabledAt: Date | null;
  backupCodesRemaining: number;
}> {
  const session = await requireSession();
  const subjectField = subjectColumn(roleToSubjectKind(session.role));
  return withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    async (tx) => {
      const cred = await tx.authCredential.findFirst({
        where: { tenantId: session.tenantId, [subjectField]: session.subjectId },
        select: { mfaEnabledAt: true, mfaBackupCodesHash: true },
      });
      return {
        enabled: !!cred?.mfaEnabledAt,
        enabledAt: cred?.mfaEnabledAt ?? null,
        backupCodesRemaining: cred?.mfaBackupCodesHash.length ?? 0,
      };
    }
  );
}

// Silence unused import warning — getCurrentTenant reserved for a future
// tenant-branding pass on the QR label. Keep the import so future editors
// don't have to reintroduce it.
void getCurrentTenant;
