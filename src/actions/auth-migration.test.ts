// src/actions/auth-migration.test.ts
//
// Runs with:  node --import tsx --test src/actions/auth-migration.test.ts
//
// B7.2 migration tests for src/actions/auth.ts and src/actions/signup.ts.
//
// The action functions themselves ("use server", Prisma, next/headers,
// wrapper calls, real email sends) can't be unit-tested at the function
// level without heavy mocking that undermines the security assertions.
// The verify-token failure modes (expired, wrong-purpose, malformed,
// wrong-secret) are already exhaustively covered by
// `src/core/auth/tokens.test.ts`'s 18 tests against the same
// `verifyPurposeToken` these actions now call.
//
// The specific property B7.2 introduces and this file pins:
// **every migrated call site invokes verifyPurposeToken / signPurposeToken
// with the correct purpose literal**, so a future edit that flipped
// "password-reset" to "invite" (or forgot to pass a purpose at all)
// fails a test rather than shipping a cross-purpose-confusion regression.
//
// The check is source-level (grep the transpiled file) so it runs
// without spinning up Prisma / next/headers.

process.env.SESSION_SECRET = "test-secret-at-least-32-characters-long-please";

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { signPurposeToken, verifyPurposeToken } from "@/core/auth/tokens";

const AUTH_SRC = readFileSync("src/actions/auth.ts", "utf8");
const SIGNUP_SRC = readFileSync("src/actions/signup.ts", "utf8");
const EMAIL_CHANGE_SRC = readFileSync("src/actions/emailChange.ts", "utf8");
const ADMIN_SRC = readFileSync("src/actions/admin.ts", "utf8");
const ANALYTICS_SHARE_SRC = readFileSync("src/actions/analyticsShare.ts", "utf8");
const TICKETS_SRC = readFileSync("src/actions/tickets.ts", "utf8");
const CSAT_SRC = readFileSync("src/actions/csat.ts", "utf8");
const SHARED_REPORT_SRC = readFileSync(
  "src/app/reports/shared/[token]/page.tsx",
  "utf8"
);
const DATA_EXPORT_ROUTE_SRC = readFileSync(
  "src/app/api/data-export/[token]/route.ts",
  "utf8"
);

// -----------------------------------------------------------------
// Purpose-literal wire-shape pins — actions/auth.ts
// -----------------------------------------------------------------
describe("actions/auth.ts — purpose-literal call-site pins", () => {
  it("no residual imports of the wrapper functions that were migrated", () => {
    // The five migrated functions (Support wrappers) must be gone from
    // the imports. If they reappear, someone accidentally reintroduced
    // the pre-migration surface. Cookie R/W is expected to remain.
    for (const removed of [
      "signPasswordResetToken",
      "verifyPasswordResetToken",
      "verifyInviteToken",
      "signOtpSessionToken",
      "verifyOtpSessionToken",
    ]) {
      assert.doesNotMatch(
        AUTH_SRC,
        new RegExp(`import[^;]*\\b${removed}\\b`),
        `${removed} must not be imported after B7.2 migration`
      );
    }
    // Cookie R/W stays per B6.0 Category B/C.
    assert.match(AUTH_SRC, /import \{ createSessionCookie, destroySessionCookie \} from "@\/lib\/session"/);
    assert.match(AUTH_SRC, /import \{ signPurposeToken, verifyPurposeToken \} from "@\/core\/auth\/tokens"/);
  });

  it("password-reset flow calls sign/verify with the correct purpose literal", () => {
    assert.match(AUTH_SRC, /signPurposeToken\("password-reset",/);
    assert.match(AUTH_SRC, /verifyPurposeToken\(data\.token, "password-reset"\)/);
  });

  it("invite-accept flow calls verify with 'invite' purpose", () => {
    assert.match(AUTH_SRC, /verifyPurposeToken\(data\.token, "invite"\)/);
  });

  it("otp-verify flow calls sign/verify with 'otp-verify' purpose (both call sites)", () => {
    const signMatches = AUTH_SRC.match(/signPurposeToken\("otp-verify",/g) ?? [];
    const verifyMatches = AUTH_SRC.match(/verifyPurposeToken\(data\.otpToken, "otp-verify"\)/g) ?? [];
    // registerClient signs an otp token (line ~131), verifyRegistrationOtp
    // verifies it (line ~152); requestLoginOtp signs (line ~610),
    // verifyLoginOtp verifies (line ~619). Two sign + two verify.
    assert.equal(signMatches.length, 2, "expected 2 signPurposeToken('otp-verify', ...) sites");
    assert.equal(verifyMatches.length, 2, "expected 2 verifyPurposeToken(data.otpToken, 'otp-verify') sites");
  });

  it("no verifyPurposeToken call is missing its purpose argument", () => {
    // A verify call without a second arg means someone forgot to
    // add the purpose after removing the wrapper — that would break
    // the cross-purpose confusion guard (verifyPurposeToken with
    // undefined expectedPurpose passes if payload.purpose === undefined,
    // which no legitimate token in this codebase carries any more).
    const bareCalls =
      AUTH_SRC.match(/verifyPurposeToken\([^,)]*\)/g) ?? [];
    assert.equal(
      bareCalls.length,
      0,
      `bare verifyPurposeToken call(s) missing purpose arg: ${bareCalls.join(", ")}`
    );
  });
});

// -----------------------------------------------------------------
// Purpose-literal wire-shape pins — actions/signup.ts
// -----------------------------------------------------------------
describe("actions/signup.ts — purpose-literal call-site pins", () => {
  it("no residual imports of migrated wrapper functions", () => {
    for (const removed of ["signTenantSignupToken", "verifyTenantSignupToken"]) {
      assert.doesNotMatch(
        SIGNUP_SRC,
        new RegExp(`import[^;]*\\b${removed}\\b`),
        `${removed} must not be imported after B7.2 migration`
      );
    }
    assert.match(SIGNUP_SRC, /import \{ createSessionCookie \} from "@\/lib\/session"/);
    assert.match(SIGNUP_SRC, /import \{ signPurposeToken, verifyPurposeToken \} from "@\/core\/auth\/tokens"/);
  });

  it("tenant-signup sign + verify use the correct purpose literal", () => {
    assert.match(SIGNUP_SRC, /signPurposeToken\("tenant-signup",/);
    assert.match(SIGNUP_SRC, /verifyPurposeToken\(parsed\.data\.otpToken, "tenant-signup"\)/);
  });

  it("no verifyPurposeToken call is missing its purpose argument", () => {
    const bareCalls =
      SIGNUP_SRC.match(/verifyPurposeToken\([^,)]*\)/g) ?? [];
    assert.equal(bareCalls.length, 0);
  });
});

// -----------------------------------------------------------------
// B7.3 — actions/emailChange.ts call-site pins
// -----------------------------------------------------------------
describe("actions/emailChange.ts — purpose-literal call-site pins (B7.3)", () => {
  it("no residual imports of migrated wrapper functions", () => {
    for (const removed of ["signEmailChangeToken", "verifyEmailChangeToken"]) {
      assert.doesNotMatch(
        EMAIL_CHANGE_SRC,
        new RegExp(`import[^;]*\\b${removed}\\b`),
        `${removed} must not be imported after B7.3 migration`
      );
    }
    assert.match(
      EMAIL_CHANGE_SRC,
      /import \{ signPurposeToken, verifyPurposeToken \} from "@\/core\/auth\/tokens"/
    );
    // emailChange.ts has NO cookie-permanent imports — the whole
    // Support-side session import goes away, unlike auth.ts/signup.ts
    // which retain createSessionCookie et al.
    assert.doesNotMatch(EMAIL_CHANGE_SRC, /from "@\/lib\/session"/);
  });

  it("email-change flow calls sign/verify with the correct purpose literal", () => {
    assert.match(EMAIL_CHANGE_SRC, /signPurposeToken\("email-change",/);
    assert.match(EMAIL_CHANGE_SRC, /verifyPurposeToken\(parsed\.data\.token, "email-change"\)/);
  });

  it("no verifyPurposeToken call is missing its purpose argument", () => {
    const bareCalls =
      EMAIL_CHANGE_SRC.match(/verifyPurposeToken\([^,)]*\)/g) ?? [];
    assert.equal(bareCalls.length, 0);
  });
});

// -----------------------------------------------------------------
// B7.3 — email-change payload round-trip (adds newEmail field on
// top of the {userId, tenantId} base)
// -----------------------------------------------------------------
describe("email-change payload round-trip (B7.3)", () => {
  it("full {userId, tenantId, newEmail} payload survives sign → verify", async () => {
    const t = await signPurposeToken("email-change", {
      userId: "u-1",
      tenantId: "tenant-1",
      newEmail: "new@example.com",
    });
    const decoded = await verifyPurposeToken(t, "email-change");
    assert.ok(decoded);
    assert.equal(decoded.userId, "u-1");
    assert.equal(decoded.tenantId, "tenant-1");
    assert.equal(decoded.newEmail, "new@example.com");
  });

  it("cross-purpose: an email-change token cannot pass password-reset verify", async () => {
    // The most likely confusion in this action: both purposes take
    // {userId, tenantId} shapes, so an attacker who obtained a valid
    // email-change link might try posting it to /auth/reset/confirm.
    // The purpose claim closes that.
    const t = await signPurposeToken("email-change", {
      userId: "u-1",
      tenantId: "tenant-1",
      newEmail: "new@example.com",
    });
    const asReset = await verifyPurposeToken(t, "password-reset");
    assert.equal(asReset, null);
  });
});

// -----------------------------------------------------------------
// B7.4 — actions/admin.ts call-site pins (invite tokens)
// -----------------------------------------------------------------
describe("actions/admin.ts — purpose-literal call-site pins (B7.4)", () => {
  it("no residual signInviteToken import; core import present; no @/lib/session residue", () => {
    assert.doesNotMatch(
      ADMIN_SRC,
      /import[^;]*\bsignInviteToken\b/,
      "signInviteToken must not be imported after B7.4 migration"
    );
    assert.match(ADMIN_SRC, /import \{ signPurposeToken \} from "@\/core\/auth\/tokens"/);
    assert.doesNotMatch(
      ADMIN_SRC,
      /from "@\/lib\/session"/,
      "actions/admin.ts is fully cookie-free — nothing should remain from @/lib/session"
    );
  });

  it("all three invite-signing call sites use signPurposeToken(\"invite\", …)", () => {
    // Pre-migration count was 3 (inviteUser + 2 resend-invite paths).
    // If a future edit adds a 4th or drops one silently, this pins
    // it so the reviewer sees the shape change. Anchor on `await` to
    // exclude JSDoc mentions that reference the function name.
    const matches = ADMIN_SRC.match(/await signPurposeToken\("invite",/g) ?? [];
    assert.equal(matches.length, 3, `expected 3 await sign('invite') sites, got ${matches.length}`);
  });
});

// -----------------------------------------------------------------
// B7.4 — actions/analyticsShare.ts call-site pins
//
// Special: analytics_share purpose uses snake_case per §7.16. If the
// migration accidentally normalised it to "analytics-share" (kebab-case,
// matching the other purposes), every live 30-day share link would
// silently 401 on the next click. Pinning the exact literal here.
// -----------------------------------------------------------------
describe("actions/analyticsShare.ts — purpose-literal call-site pins (B7.4)", () => {
  it("no residual signAnalyticsShareToken import; core import present; no @/lib/session residue", () => {
    assert.doesNotMatch(
      ANALYTICS_SHARE_SRC,
      /import[^;]*\bsignAnalyticsShareToken\b/
    );
    assert.match(
      ANALYTICS_SHARE_SRC,
      /import \{ signPurposeToken \} from "@\/core\/auth\/tokens"/
    );
    assert.doesNotMatch(ANALYTICS_SHARE_SRC, /from "@\/lib\/session"/);
  });

  it("purpose literal is EXACTLY 'analytics_share' (snake_case, §7.16 wire compat)", () => {
    // Precise literal match — no `snake_case` inference, no kebab.
    // If the sign call becomes `signPurposeToken("analytics-share", …)`
    // this fails immediately. That would invalidate every live share
    // link (30-day TTL) the moment the tightened verify is deployed.
    assert.match(ANALYTICS_SHARE_SRC, /signPurposeToken\("analytics_share",/);
    // And explicitly ensure no accidental kebab-case slipped in.
    assert.doesNotMatch(
      ANALYTICS_SHARE_SRC,
      /["']analytics-share["']/,
      "kebab-case analytics-share would invalidate every live share link — §7.16 preserves snake_case"
    );
  });
});

// -----------------------------------------------------------------
// B7.4 — invite payload round-trip
// -----------------------------------------------------------------
describe("invite payload round-trip (B7.4)", () => {
  it("{userId, tenantId} survives sign → verify with 'invite' purpose", async () => {
    const t = await signPurposeToken("invite", {
      userId: "u-1",
      tenantId: "tenant-1",
    });
    const decoded = await verifyPurposeToken(t, "invite");
    assert.ok(decoded);
    assert.equal(decoded.userId, "u-1");
    assert.equal(decoded.tenantId, "tenant-1");
  });

  it("cross-purpose: an invite token cannot pass password-reset verify", async () => {
    // {userId, tenantId} shape overlaps password-reset — the invite
    // link route is admin-controlled, but a leaked one shouldn't
    // grant a password-reset scope. Purpose claim closes that path.
    const t = await signPurposeToken("invite", {
      userId: "u-1",
      tenantId: "tenant-1",
    });
    assert.equal(await verifyPurposeToken(t, "password-reset"), null);
    assert.equal(await verifyPurposeToken(t, "otp-verify"), null);
  });
});

// -----------------------------------------------------------------
// B7.4 — analytics_share payload round-trip + snake_case wire pin
// -----------------------------------------------------------------
describe("analytics_share payload round-trip (B7.4) — §7.16 snake_case", () => {
  it("{tenantId, filters} survives sign → verify with EXACT 'analytics_share' literal", async () => {
    const filters = { org: "acme", status: ["OPEN", "IN_PROGRESS"] };
    const t = await signPurposeToken("analytics_share", {
      tenantId: "tenant-1",
      filters,
    });
    const decoded = await verifyPurposeToken(t, "analytics_share");
    assert.ok(decoded);
    assert.equal(decoded.tenantId, "tenant-1");
    assert.deepEqual(decoded.filters, filters);
  });

  it("kebab-case 'analytics-share' does NOT verify (§7.16 wire pin)", async () => {
    // Sign with the correct snake_case, try to verify with the wrong
    // kebab-case — must return null. If a future refactor "normalised"
    // the casing in verifyPurposeToken (or in a caller passing the
    // wrong literal), this test fails immediately.
    const t = await signPurposeToken("analytics_share", {
      tenantId: "tenant-1",
      filters: {},
    });
    const wrong = await verifyPurposeToken(t, "analytics-share" as never);
    assert.equal(wrong, null, "kebab-case must NOT verify a snake_case-signed token");
  });

  it("cross-purpose: share-link token cannot pass any other purpose verify", async () => {
    const t = await signPurposeToken("analytics_share", {
      tenantId: "tenant-1",
      filters: { org: "acme" },
    });
    // Every other purpose in the PurposePayloads map.
    for (const wrongPurpose of [
      "session", "impersonation", "password-reset", "email-change",
      "data-export", "invite", "otp-verify", "tenant-signup", "csat",
    ] as const) {
      const r = await verifyPurposeToken(t, wrongPurpose);
      assert.equal(r, null, `cross-purpose: analytics_share must not verify as ${wrongPurpose}`);
    }
  });
});

// -----------------------------------------------------------------
// B7.5 — actions/tickets.ts dead-import cleanup
//
// B7.0 enumeration assumed tickets.ts had a live signCsatToken call
// site — reality: the import was orphaned dead code (CSAT link
// generation lives in lib/inngest/functions/send-csat-queue.ts).
// B7.5 removed the dead import rather than fabricating a migration.
// This test pins that outcome so a future edit can't reintroduce
// the drift.
// -----------------------------------------------------------------
describe("actions/tickets.ts — dead-import cleanup (B7.5)", () => {
  it("has zero references to signCsatToken (dead code removed)", () => {
    assert.doesNotMatch(
      TICKETS_SRC,
      /\bsignCsatToken\b/,
      "signCsatToken import was dead code — CSAT link generation lives in send-csat-queue.ts"
    );
  });

  it("does NOT import any purpose-token function (no migration was needed)", () => {
    // If a future refactor reintroduces CSAT signing into tickets.ts,
    // this test fires — signalling the reviewer should also update the
    // pinning tests + boundary docs to reflect the new call site.
    assert.doesNotMatch(TICKETS_SRC, /signPurposeToken|verifyPurposeToken/);
  });
});

// -----------------------------------------------------------------
// B7.5 — actions/csat.ts call-site pins (Portal-side verify)
// -----------------------------------------------------------------
describe("actions/csat.ts — purpose-literal call-site pins (B7.5)", () => {
  it("no residual verifyCsatToken import; core import present; no @/lib/session residue", () => {
    assert.doesNotMatch(CSAT_SRC, /import[^;]*\bverifyCsatToken\b/);
    assert.match(
      CSAT_SRC,
      /import \{ verifyPurposeToken \} from "@\/core\/auth\/tokens"/
    );
    assert.doesNotMatch(CSAT_SRC, /from "@\/lib\/session"/);
  });

  it("both verify sites (getCsatContext + submitCsatRating) use 'csat' purpose", () => {
    const matches = CSAT_SRC.match(/verifyPurposeToken\([^,]+, "csat"\)/g) ?? [];
    assert.equal(matches.length, 2, `expected 2 verify('csat') sites, got ${matches.length}`);
  });

  it("no verifyPurposeToken call is missing its purpose argument", () => {
    const bareCalls =
      CSAT_SRC.match(/verifyPurposeToken\([^,)]*\)/g) ?? [];
    assert.equal(bareCalls.length, 0);
  });
});

// -----------------------------------------------------------------
// B7.5 — reports/shared/[token]/page.tsx (Portal-side share link)
// -----------------------------------------------------------------
describe("app/reports/shared/[token]/page.tsx — purpose-literal pins (B7.5)", () => {
  it("no residual verifyAnalyticsShareToken import; core import present; no @/lib/session residue", () => {
    // Anchor on `import` so a migration-comment mention of the old name
    // doesn't trip the check (same discipline as B7.4's admin.ts pin).
    assert.doesNotMatch(
      SHARED_REPORT_SRC,
      /import[^;]*\bverifyAnalyticsShareToken\b/
    );
    assert.match(
      SHARED_REPORT_SRC,
      /import \{ verifyPurposeToken \} from "@\/core\/auth\/tokens"/
    );
    assert.doesNotMatch(SHARED_REPORT_SRC, /from "@\/lib\/session"/);
  });

  it("purpose literal is EXACTLY 'analytics_share' (snake_case, §7.16)", () => {
    // Same §7.16 wire pin as B7.4's sign-side check, now on the
    // verify side. If the verify literal ever normalises to kebab-case
    // (say `analytics-share`), every currently-signed share link
    // stops verifying — silent 30-day expiry storm.
    assert.match(SHARED_REPORT_SRC, /verifyPurposeToken\(token, "analytics_share"\)/);
    assert.doesNotMatch(
      SHARED_REPORT_SRC,
      /["']analytics-share["']/,
      "kebab-case would invalidate every live share link"
    );
  });
});

// -----------------------------------------------------------------
// B7.5 — api/data-export/[token]/route.ts (API-side data-export link)
// -----------------------------------------------------------------
describe("app/api/data-export/[token]/route.ts — purpose-literal pins (B7.5)", () => {
  it("no residual verifyDataExportToken import; core import present; no @/lib/session residue", () => {
    assert.doesNotMatch(
      DATA_EXPORT_ROUTE_SRC,
      /import[^;]*\bverifyDataExportToken\b/
    );
    assert.match(
      DATA_EXPORT_ROUTE_SRC,
      /import \{ verifyPurposeToken \} from "@\/core\/auth\/tokens"/
    );
    assert.doesNotMatch(DATA_EXPORT_ROUTE_SRC, /from "@\/lib\/session"/);
  });

  it("purpose literal is EXACTLY 'data-export' (kebab-case)", () => {
    assert.match(DATA_EXPORT_ROUTE_SRC, /verifyPurposeToken\(token, "data-export"\)/);
    // Guard against snake-case slippage in the other direction.
    assert.doesNotMatch(DATA_EXPORT_ROUTE_SRC, /["']data_export["']/);
  });
});

// -----------------------------------------------------------------
// B7.5 — CSAT lifecycle sign-verify parity (Agent-cron → Portal action)
//
// The lifecycle: Inngest send-csat-queue signs a "csat" token,
// emails it as a /rate/<token> link, csat.ts verifies it when the
// client clicks through. If sign and verify diverge on payload
// shape or purpose literal, the whole feature silently breaks 5
// minutes after CsatQueue drains its next batch. This test proves
// the round-trip is byte-parity.
// -----------------------------------------------------------------
describe("CSAT lifecycle sign-verify parity (B7.5) — cron → portal round-trip", () => {
  it("token signed by the cron shape verifies cleanly at the portal shape", async () => {
    // Exact shape used by src/lib/inngest/functions/send-csat-queue.ts
    // (B7.1 migration) — { ticketId, tenantId }.
    const cronSigned = await signPurposeToken("csat", {
      ticketId: "ticket-abc",
      tenantId: "tenant-xyz",
    });

    // Exact shape used by src/actions/csat.ts (B7.5 migration).
    const portalVerified = await verifyPurposeToken(cronSigned, "csat");

    assert.ok(portalVerified, "portal must verify what the cron signed");
    assert.equal(portalVerified.ticketId, "ticket-abc");
    assert.equal(portalVerified.tenantId, "tenant-xyz");
  });

  it("CsatTokenPayload shape is exactly {ticketId, tenantId} — no drift on either side", async () => {
    // If either side (cron sign or portal verify) added a field
    // silently, this catches it. Enumeration of the decoded keys
    // pins the wire shape.
    const t = await signPurposeToken("csat", {
      ticketId: "t-1",
      tenantId: "tenant-1",
    });
    const decoded = await verifyPurposeToken(t, "csat");
    assert.ok(decoded);
    // Sort so the assertion is stable regardless of key order.
    const keys = Object.keys(decoded).sort();
    // iat comes from jose (issued-at) — that's expected and not a drift.
    assert.deepEqual(keys, ["iat", "tenantId", "ticketId"]);
  });
});

// -----------------------------------------------------------------
// B7.5 — data-export payload round-trip + cross-purpose guard
// -----------------------------------------------------------------
describe("data-export payload round-trip (B7.5)", () => {
  it("{requestId, tenantId, subjectId} survives sign → verify", async () => {
    const t = await signPurposeToken("data-export", {
      requestId: "req-1",
      tenantId: "tenant-1",
      subjectId: "u-1",
    });
    const decoded = await verifyPurposeToken(t, "data-export");
    assert.ok(decoded);
    assert.equal(decoded.requestId, "req-1");
    assert.equal(decoded.tenantId, "tenant-1");
    assert.equal(decoded.subjectId, "u-1");
  });

  it("cross-purpose: a data-export token cannot pass password-reset or session verify", async () => {
    const t = await signPurposeToken("data-export", {
      requestId: "req-1",
      tenantId: "tenant-1",
      subjectId: "u-1",
    });
    assert.equal(await verifyPurposeToken(t, "password-reset"), null);
    assert.equal(await verifyPurposeToken(t, "session"), null);
    assert.equal(await verifyPurposeToken(t, "csat"), null);
  });
});

// -----------------------------------------------------------------
// End-to-end tokens: the payload shapes the actions rely on
// -----------------------------------------------------------------
describe("token round-trips — payloads the migrated actions rely on", () => {
  it("password-reset: {userId, tenantId} round-trips through signPurposeToken/verifyPurposeToken", async () => {
    // This is the exact shape actions/auth.ts's requestPasswordReset
    // signs and confirmPasswordReset verifies. If PurposePayloads
    // ("password-reset") ever drifts from {userId, tenantId, iat?},
    // this test breaks — flagging the drift before it hits prod.
    const t = await signPurposeToken("password-reset", {
      userId: "u-1",
      tenantId: "tenant-1",
    });
    const decoded = await verifyPurposeToken(t, "password-reset");
    assert.ok(decoded);
    assert.equal(decoded.userId, "u-1");
    assert.equal(decoded.tenantId, "tenant-1");
  });

  it("otp-verify: {userId, tenantId} round-trips", async () => {
    const t = await signPurposeToken("otp-verify", {
      userId: "u-1",
      tenantId: "tenant-1",
    });
    const decoded = await verifyPurposeToken(t, "otp-verify");
    assert.ok(decoded);
    assert.equal(decoded.userId, "u-1");
    assert.equal(decoded.tenantId, "tenant-1");
  });

  it("invite: {userId, tenantId} round-trips", async () => {
    const t = await signPurposeToken("invite", {
      userId: "u-1",
      tenantId: "tenant-1",
    });
    const decoded = await verifyPurposeToken(t, "invite");
    assert.ok(decoded);
    assert.equal(decoded.userId, "u-1");
    assert.equal(decoded.tenantId, "tenant-1");
  });

  it("tenant-signup: full 6-field payload round-trips (adminEmail, codeHash, etc.)", async () => {
    // actions/signup.ts's payload — the biggest one. If any field
    // is dropped during (de)serialization, the verifyTenantSignup
    // handler would fail with a null lookup. This pins the invariant.
    const payload = {
      tenantName: "Acme",
      slug: "acme",
      adminName: "Alice",
      adminEmail: "alice@acme.test",
      passwordHash: "$2a$10$dummyhash",
      codeHash: "$2a$10$dummycodehash",
    };
    const t = await signPurposeToken("tenant-signup", payload);
    const decoded = await verifyPurposeToken(t, "tenant-signup");
    assert.ok(decoded);
    assert.equal(decoded.tenantName, "Acme");
    assert.equal(decoded.slug, "acme");
    assert.equal(decoded.adminName, "Alice");
    assert.equal(decoded.adminEmail, "alice@acme.test");
    assert.equal(decoded.passwordHash, "$2a$10$dummyhash");
    assert.equal(decoded.codeHash, "$2a$10$dummycodehash");
  });

  it("cross-purpose confusion is blocked: an otp-verify token cannot pass password-reset verify", async () => {
    // This is THE attack the purpose claim closes. If actions/auth.ts's
    // confirmPasswordReset accidentally verified against "otp-verify"
    // (or verifyPurposeToken accepted mismatched purposes), a stolen
    // OTP token pasted as a reset link would log the attacker into
    // password-reset flow. Re-pinned here because this file's whole
    // point is the migration correctness of purpose literals.
    const otp = await signPurposeToken("otp-verify", {
      userId: "u-1",
      tenantId: "tenant-1",
    });
    const asReset = await verifyPurposeToken(otp, "password-reset");
    assert.equal(asReset, null);
    const asInvite = await verifyPurposeToken(otp, "invite");
    assert.equal(asInvite, null);
    const asSignup = await verifyPurposeToken(otp, "tenant-signup");
    assert.equal(asSignup, null);
  });

  it("expired token cleanly returns null (no throw) — actions treat null as 'link is invalid or expired'", async () => {
    // The migrated flow: verifyPurposeToken returns null → the action
    // returns { error: "This reset link is invalid or has expired." }
    // as a plain user-facing error. If verify ever throws instead,
    // the action would crash with an unhandled 500 and leak internals.
    const expired = await signPurposeToken(
      "password-reset",
      { userId: "u-1", tenantId: "tenant-1" },
      { ttlSeconds: 1 }
    );
    await new Promise((r) => setTimeout(r, 1500));
    const decoded = await verifyPurposeToken(expired, "password-reset");
    assert.equal(decoded, null);
  });

  it("malformed token returns null cleanly", async () => {
    for (const bad of ["", "not.a.jwt", "garbage.header.body"]) {
      const decoded = await verifyPurposeToken(bad, "password-reset");
      assert.equal(decoded, null);
    }
  });

  it("wrong-secret token returns null (cross-tenant attack proxy: a token signed elsewhere is rejected)", async () => {
    const { SignJWT } = await import("jose");
    const forged = await new SignJWT({
      userId: "attacker",
      tenantId: "tenant-1",
      purpose: "password-reset",
    })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("30m")
      .sign(new TextEncoder().encode("a-completely-different-secret-32c"));
    const decoded = await verifyPurposeToken(forged, "password-reset");
    assert.equal(decoded, null);
  });
});
