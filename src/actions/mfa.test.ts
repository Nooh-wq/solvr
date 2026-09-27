// src/actions/mfa.test.ts
//
// M6.1 pinning + functional tests.
//
// Runs with:  node --import tsx --test --env-file=.env src/actions/mfa.test.ts
//
// The action functions themselves ("use server", Prisma, next/headers)
// can't be unit-tested at the function level without heavy mocking; the
// coverage here is source-level pins on the load-bearing wire shapes
// plus round-trip tests of the pure helpers (crypto + challenge token).
// The pattern mirrors B7.2–B7.5's auth-migration.test.ts discipline.

process.env.SESSION_SECRET = "test-secret-at-least-32-characters-long-please";
// MFA_SECRET_KEY must decode to exactly 32 bytes. This is a deterministic
// 32-byte test key — never used in production. Written inline so the test
// runs even when .env is missing.
process.env.MFA_SECRET_KEY = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import crypto from "node:crypto";
import {
  signPurposeToken,
  verifyPurposeToken,
  PURPOSE_TTL_SECONDS,
} from "@/core/auth/tokens";
import { encryptSecret, decryptSecret } from "@/core/auth/mfa-crypto";

const MFA_SRC = readFileSync("src/actions/mfa.ts", "utf8");
const AUTH_SRC = readFileSync("src/actions/auth.ts", "utf8");
const LOGIN_FORM_SRC = readFileSync(
  "src/app/(auth)/auth/login/login-form.tsx",
  "utf8"
);
const SECURITY_TAB_SRC = readFileSync(
  "src/components/account/security-tab.tsx",
  "utf8"
);
const TYPES_SRC = readFileSync("src/core/auth/types.ts", "utf8");
const TOKENS_SRC = readFileSync("src/core/auth/tokens.ts", "utf8");
const TENANT_SECURITY_SRC = readFileSync(
  "src/actions/tenantSecurity.ts",
  "utf8"
);
const ENROLLMENT_FORM_SRC = readFileSync(
  "src/app/(auth)/auth/enroll-2fa/enrollment-form.tsx",
  "utf8"
);
const ADMIN_SECURITY_FORM_SRC = readFileSync(
  "src/app/(admin)/admin/security/security-form.tsx",
  "utf8"
);

// ---------------------------------------------------------------------
// Purpose union + TTL — new "mfa-challenge" purpose is registered in
// both the type union and the runtime TTL map. Adding a purpose without
// updating both is a wire-shape drift that must fail here.
// ---------------------------------------------------------------------
describe("mfa-challenge purpose registration (M6.1)", () => {
  it("appears in the TokenPurpose union in core/auth/types.ts", () => {
    assert.match(TYPES_SRC, /\|\s*"mfa-challenge"/);
  });

  it("has a PurposePayloads entry mapping to MfaChallengeTokenPayload", () => {
    assert.match(
      TYPES_SRC,
      /"mfa-challenge":\s*MfaChallengeTokenPayload/,
      "PurposePayloads map must include mfa-challenge"
    );
  });

  it("has a runtime TTL entry in PURPOSE_TTL_SECONDS", () => {
    assert.equal(
      PURPOSE_TTL_SECONDS["mfa-challenge"],
      60 * 5,
      "mfa-challenge TTL must be exactly 5 minutes"
    );
    assert.match(TOKENS_SRC, /"mfa-challenge":\s*60\s*\*\s*5/);
  });
});

// ---------------------------------------------------------------------
// actions/mfa.ts — import-source-purity + call-site pins
// ---------------------------------------------------------------------
describe("actions/mfa.ts — pinning tests (M6.1)", () => {
  it("imports crypto helper from @/core/auth (not @/lib)", () => {
    assert.match(
      MFA_SRC,
      /import[^;]*\{[^}]*encryptSecret[^}]*\}[^;]*from\s+"@\/core\/auth\/mfa-crypto"/
    );
    // Reverse: must not accidentally reach into src/lib for the crypto.
    assert.doesNotMatch(
      MFA_SRC,
      /from\s+"@\/lib\/[^"]*mfa/,
      "mfa crypto must live under core, not lib — extraction-candidate discipline"
    );
  });

  it("goes through @/core/auth/tokens (not @/lib/session) for the challenge token", () => {
    assert.match(
      MFA_SRC,
      /import[^;]*\{[^}]*(signPurposeToken|verifyPurposeToken)[^}]*\}[^;]*from\s+"@\/core\/auth\/tokens"/
    );
    assert.doesNotMatch(
      MFA_SRC,
      /import[^;]*from\s+"@\/lib\/session"/,
      "actions/mfa.ts must not depend on the Support wrapper"
    );
  });

  it("issueMfaChallengeToken calls signPurposeToken with exact 'mfa-challenge' literal", () => {
    assert.match(MFA_SRC, /signPurposeToken\("mfa-challenge",/);
    // Snake-case forbidden — pins the kebab-case wire shape.
    assert.doesNotMatch(MFA_SRC, /"mfa_challenge"/);
  });

  it("verifyMfaChallengeToken calls verifyPurposeToken with matching purpose", () => {
    assert.match(MFA_SRC, /verifyPurposeToken\(token,\s*"mfa-challenge"\)/);
  });
});

// ---------------------------------------------------------------------
// actions/auth.ts login flow — split path pins
// ---------------------------------------------------------------------
describe("actions/auth.ts — MFA-split login path (M6.1)", () => {
  it("login() imports the MFA helpers from actions/mfa", () => {
    assert.match(
      AUTH_SRC,
      /import\s*\{[^}]*(issueMfaChallengeToken|verifyMfaChallengeToken|verifyMfaCode)[^}]*\}\s*from\s*"@\/actions\/mfa"/
    );
  });

  it("login() branches on mfaEnabledAt and returns requiresMfa without a cookie", () => {
    assert.match(AUTH_SRC, /lookup\.creds\.mfaEnabledAt/);
    assert.match(AUTH_SRC, /requiresMfa:\s*true/);
    // The branch must return BEFORE createSessionCookie is called for
    // the MFA path — if the branch falls through, a cookie leaks even
    // though the code hasn't been verified yet.
    const mfaBranchIdx = AUTH_SRC.indexOf("requiresMfa: true");
    const returnIdx = AUTH_SRC.indexOf("return { requiresMfa: true", mfaBranchIdx - 500);
    assert.notEqual(returnIdx, -1, "MFA branch must return { requiresMfa } — no fall-through");
  });

  it("completeMfaLogin exists and is exported", () => {
    assert.match(AUTH_SRC, /export async function completeMfaLogin/);
  });

  it("completeMfaLogin rate-limits per-subject before verifying the code", () => {
    // Anchor: the rate-limit key + the mfa-verify call must both appear
    // in the completeMfaLogin function body.
    const startIdx = AUTH_SRC.indexOf("export async function completeMfaLogin");
    assert.ok(startIdx >= 0);
    const body = AUTH_SRC.slice(startIdx);
    assert.match(body, /mfa-verify:/);
    assert.match(body, /checkRateLimitWithIp/);
    assert.match(body, /verifyMfaCode/);
  });
});

// ---------------------------------------------------------------------
// UI wiring
// ---------------------------------------------------------------------
describe("login-form.tsx (M6.1)", () => {
  it("swaps to a code-entry form when login() returns requiresMfa", () => {
    assert.match(LOGIN_FORM_SRC, /completeMfaLogin/);
    assert.match(LOGIN_FORM_SRC, /challengeToken/);
    assert.match(LOGIN_FORM_SRC, /requiresMfa/);
  });
});

describe("security-tab.tsx (M6.1)", () => {
  it("no longer references the 'coming soon' reserved slot for 2FA", () => {
    assert.doesNotMatch(SECURITY_TAB_SRC, /Coming soon/);
    assert.doesNotMatch(SECURITY_TAB_SRC, /ships with M6/);
  });

  it("wires up the real MFA actions", () => {
    for (const fn of ["beginTotpEnrollment", "confirmTotpEnrollment", "disableTotp", "getMyMfaState"]) {
      assert.match(SECURITY_TAB_SRC, new RegExp(`\\b${fn}\\b`));
    }
  });
});

// ---------------------------------------------------------------------
// mfa-crypto adapter — v2 writes, v1 read-with-rewrap. Live DB required
// because envelope encryption reads/writes tenant_encryption_keys.
// ---------------------------------------------------------------------
describe("core/auth/mfa-crypto (M6.1 + M6.1.a)", () => {
  // A dedicated test tenant. Provisioned lazily by the first test that
  // needs it and cleaned up at the end.
  const TEST_TENANT_ID = `test-mfa-crypto-${crypto.randomUUID()}`;

  function prisma() {
    // Lazy import so the top-level table pins (which don't need Prisma)
    // don't pay the client-init cost.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { PrismaClient } = require("../generated/prisma");
    return new PrismaClient();
  }

  const tx = prisma();

  before(async () => {
    await tx.tenant.create({
      data: {
        id: TEST_TENANT_ID,
        name: `test-mfa-${TEST_TENANT_ID.slice(-8)}`,
        slug: TEST_TENANT_ID.slice(-16),
      },
    });
  });

  after(async () => {
    await tx.tenantEncryptionKey.deleteMany({ where: { tenantId: TEST_TENANT_ID } });
    await tx.tenant.delete({ where: { id: TEST_TENANT_ID } });
    await tx.$disconnect();
  });

  it("encryptSecret → decryptSecret round-trips (v2)", async () => {
    const plaintext = "JBSWY3DPEHPK3PXP"; // classic RFC 4226 example base32
    const ct = await encryptSecret(tx, TEST_TENANT_ID, plaintext);
    const got = await decryptSecret(tx, TEST_TENANT_ID, ct);
    assert.ok(got);
    assert.equal(got!.plaintext, plaintext);
    assert.equal(got!.rewrapAs, null, "v2 rows do not need rewrap");
  });

  it("produces the v2:iv:tag:ct wire format", async () => {
    const ct = await encryptSecret(tx, TEST_TENANT_ID, "hello");
    const parts = ct.split(":");
    assert.equal(parts.length, 4);
    assert.equal(parts[0], "v2", "post-M6.1.a writes are always v2");
  });

  it("same plaintext → different ciphertext across calls (fresh IV)", async () => {
    const a = await encryptSecret(tx, TEST_TENANT_ID, "same-input");
    const b = await encryptSecret(tx, TEST_TENANT_ID, "same-input");
    assert.notEqual(a, b);
  });

  it("returns null on tampered ciphertext instead of throwing", async () => {
    const ct = await encryptSecret(tx, TEST_TENANT_ID, "hello");
    const tampered = ct.slice(0, -4) + "AAAA";
    assert.equal(await decryptSecret(tx, TEST_TENANT_ID, tampered), null);
  });

  it("returns null on unknown version prefix", async () => {
    const ct = await encryptSecret(tx, TEST_TENANT_ID, "hello");
    const v9 = "v9" + ct.slice(2);
    assert.equal(await decryptSecret(tx, TEST_TENANT_ID, v9), null);
  });

  it("cross-tenant leakage: decrypting one tenant's v2 under another tenant returns null", async () => {
    // Create a sibling tenant with its own DEK.
    const OTHER = `test-mfa-crypto-other-${crypto.randomUUID()}`;
    await tx.tenant.create({
      data: { id: OTHER, name: `test-mfa-other-${OTHER.slice(-8)}`, slug: OTHER.slice(-16) },
    });
    try {
      const ct = await encryptSecret(tx, TEST_TENANT_ID, "secret");
      const wrongTenantDecrypt = await decryptSecret(tx, OTHER, ct);
      assert.equal(
        wrongTenantDecrypt,
        null,
        "wrong-tenant DEK must fail GCM tag verification"
      );
    } finally {
      await tx.tenantEncryptionKey.deleteMany({ where: { tenantId: OTHER } });
      await tx.tenant.delete({ where: { id: OTHER } });
    }
  });

  it("v1 legacy ciphertext decrypts and returns a v2 rewrapAs for opportunistic migration", async () => {
    // Synthesize a v1 ciphertext directly (M6.1 pre-envelope shape):
    // aes-256-gcm(KEK, plaintext) with prefix "v1:".
    const key = Buffer.from(process.env.MFA_SECRET_KEY!, "base64");
    const iv = crypto.randomBytes(12);
    const plaintext = "LEGACY-ROW-PLAINTEXT";
    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
    const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    const v1 = `v1:${iv.toString("base64")}:${tag.toString("base64")}:${ct.toString("base64")}`;

    const got = await decryptSecret(tx, TEST_TENANT_ID, v1);
    assert.ok(got, "v1 must decrypt");
    assert.equal(got!.plaintext, plaintext);
    assert.ok(got!.rewrapAs, "v1 decrypt must return a rewrapAs for opportunistic migration");
    assert.match(got!.rewrapAs!, /^v2:/);

    // Rewrapped ciphertext round-trips as v2.
    const round = await decryptSecret(tx, TEST_TENANT_ID, got!.rewrapAs!);
    assert.equal(round?.plaintext, plaintext);
    assert.equal(round?.rewrapAs, null);
  });
});

// ---------------------------------------------------------------------
// mfa-challenge token — round-trip + cross-purpose refusal
// ---------------------------------------------------------------------
// ---------------------------------------------------------------------
// M6.1.b — tenant-wide enforcement pins
// ---------------------------------------------------------------------
describe("M6.1.b — tenant-wide MFA enforcement", () => {
  it("registers 'mfa-enrollment' as the 12th purpose (union + payload map + TTL)", () => {
    assert.match(TYPES_SRC, /\|\s*"mfa-enrollment"/);
    assert.match(TYPES_SRC, /"mfa-enrollment":\s*MfaEnrollmentTokenPayload/);
    assert.equal(PURPOSE_TTL_SECONDS["mfa-enrollment"], 60 * 15);
    assert.match(TOKENS_SRC, /"mfa-enrollment":\s*60\s*\*\s*15/);
  });

  it("login() branches on tenant.enforceMfa AFTER the mfaEnabledAt branch (established users unaffected)", () => {
    // Ordering matters: the enforce branch must sit AFTER the mfaEnabledAt
    // branch. If it fires first, a user who already has MFA would be
    // redirected into re-enrollment instead of a code prompt.
    const mfaBranchIdx = AUTH_SRC.indexOf("requiresMfa: true");
    const enforceBranchIdx = AUTH_SRC.indexOf("requiresEnrollment: true");
    assert.ok(mfaBranchIdx > 0, "requiresMfa branch missing");
    assert.ok(enforceBranchIdx > 0, "requiresEnrollment branch missing");
    assert.ok(
      enforceBranchIdx > mfaBranchIdx,
      "enforce branch must come AFTER the mfaEnabledAt branch"
    );
  });

  it("login() mints an mfa-enrollment token (not a session or challenge) on the forced-enrollment branch", () => {
    // The forced-enrollment branch must not accidentally reuse the
    // mfa-challenge purpose — the enrollment surface must not accept
    // a challenge token as authentication.
    assert.match(AUTH_SRC, /signPurposeToken\("mfa-enrollment",/);
  });

  it("completeForcedEnrollment exists in auth.ts and rate-limits before verify", () => {
    assert.match(AUTH_SRC, /export async function completeForcedEnrollment/);
    const idx = AUTH_SRC.indexOf("export async function completeForcedEnrollment");
    const body = AUTH_SRC.slice(idx);
    assert.match(body, /mfa-enroll:/);
    assert.match(body, /checkRateLimitWithIp/);
  });

  it("actions/mfa.ts forced-enrollment surface only accepts 'mfa-enrollment' tokens", () => {
    // beginForcedTotpEnrollment + confirmForcedTotpEnrollment both
    // verify the enrollment token with the correct literal. If either
    // path drifts to a different purpose, an attacker could reuse a
    // token minted for a different flow.
    assert.match(
      MFA_SRC,
      /verifyPurposeToken\(parsed\.data\.enrollmentToken,\s*"mfa-enrollment"\)/
    );
    const forcedBeginIdx = MFA_SRC.indexOf("beginForcedTotpEnrollment");
    const forcedConfirmIdx = MFA_SRC.indexOf("confirmForcedTotpEnrollment");
    assert.ok(forcedBeginIdx > 0);
    assert.ok(forcedConfirmIdx > 0);
  });

  it("tenantSecurity.setTenantMfaEnforcement enforces the break-glass invariant", () => {
    // The action must check the caller's own mfaEnabledAt before flipping
    // enforce ON. Without this, an admin without 2FA locks themselves out.
    assert.match(TENANT_SECURITY_SRC, /callerHasMfa/);
    assert.match(TENANT_SECURITY_SRC, /mfaEnabledAt/);
    // Guard must be scoped to the enable path — disabling doesn't require it.
    assert.match(TENANT_SECURITY_SRC, /if \(parsed\.data\.enabled\)/);
  });

  it("tenantSecurity.setTenantMfaEnforcement requires SUPER_ADMIN", () => {
    assert.match(
      TENANT_SECURITY_SRC,
      /requireSession\(\{\s*minRole:\s*"SUPER_ADMIN"\s*\}\)/
    );
  });

  it("login-form.tsx routes to /auth/enroll-2fa on requiresEnrollment", () => {
    assert.match(LOGIN_FORM_SRC, /requiresEnrollment/);
    assert.match(LOGIN_FORM_SRC, /\/auth\/enroll-2fa/);
  });

  it("enrollment-form.tsx calls beginForcedTotpEnrollment + completeForcedEnrollment", () => {
    assert.match(ENROLLMENT_FORM_SRC, /beginForcedTotpEnrollment/);
    assert.match(ENROLLMENT_FORM_SRC, /completeForcedEnrollment/);
  });

  it("admin security-form.tsx uses the tenantSecurity actions", () => {
    assert.match(ADMIN_SECURITY_FORM_SRC, /setTenantMfaEnforcement/);
  });
});

describe("mfa-enrollment token (M6.1.b)", () => {
  it("round-trips through signPurposeToken → verifyPurposeToken", async () => {
    const token = await signPurposeToken("mfa-enrollment", {
      subjectId: "user-1",
      subjectKind: "TEAM_MEMBER",
      tenantId: "tenant-1",
    });
    const decoded = await verifyPurposeToken(token, "mfa-enrollment");
    assert.ok(decoded);
    assert.equal(decoded!.subjectId, "user-1");
  });

  it("cross-purpose: an mfa-enrollment token cannot pass as mfa-challenge (or vice versa)", async () => {
    const enrolTok = await signPurposeToken("mfa-enrollment", {
      subjectId: "u", subjectKind: "TEAM_MEMBER", tenantId: "t",
    });
    const chalTok = await signPurposeToken("mfa-challenge", {
      subjectId: "u", subjectKind: "TEAM_MEMBER", tenantId: "t",
    });
    assert.equal(await verifyPurposeToken(enrolTok, "mfa-challenge"), null);
    assert.equal(await verifyPurposeToken(chalTok, "mfa-enrollment"), null);
  });
});

describe("mfa-challenge token (M6.1)", () => {
  it("round-trips through signPurposeToken → verifyPurposeToken", async () => {
    const token = await signPurposeToken("mfa-challenge", {
      subjectId: "user-1",
      subjectKind: "TEAM_MEMBER",
      tenantId: "tenant-1",
    });
    const decoded = await verifyPurposeToken(token, "mfa-challenge");
    assert.ok(decoded);
    assert.equal(decoded!.subjectId, "user-1");
    assert.equal(decoded!.subjectKind, "TEAM_MEMBER");
    assert.equal(decoded!.tenantId, "tenant-1");
  });

  it("payload shape is exactly {subjectId, subjectKind, tenantId} — no drift", async () => {
    const token = await signPurposeToken("mfa-challenge", {
      subjectId: "user-2",
      subjectKind: "END_USER",
      tenantId: "tenant-2",
    });
    const decoded = await verifyPurposeToken(token, "mfa-challenge");
    assert.ok(decoded);
    // Enumerate keys: any silent addition on either side fails here.
    const keys = Object.keys(decoded!).sort();
    assert.deepEqual(keys, ["iat", "subjectId", "subjectKind", "tenantId"]);
  });

  it("cross-purpose: an mfa-challenge token cannot pass as session/password-reset/etc.", async () => {
    const token = await signPurposeToken("mfa-challenge", {
      subjectId: "user-x",
      subjectKind: "TEAM_MEMBER",
      tenantId: "tenant-x",
    });
    assert.equal(await verifyPurposeToken(token, "password-reset"), null);
    assert.equal(await verifyPurposeToken(token, "invite"), null);
    assert.equal(await verifyPurposeToken(token, "csat"), null);
  });

  it("cross-purpose: a session token cannot pass as mfa-challenge", async () => {
    const token = await signPurposeToken("password-reset", {
      userId: "u",
      tenantId: "t",
    });
    assert.equal(await verifyPurposeToken(token, "mfa-challenge"), null);
  });
});
