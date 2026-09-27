# M6 — decisions we've explicitly closed off

Follow-up companion to the M6 spec. Records the M6.1 design choices that
looked plausible during scoping but that we've explicitly decided against.
Filed here so a future edit can't reintroduce them "by accident" —
someone would have to overturn a written decision first.

Updated as later M6 sub-pieces (M6.2 SAML, M6.3 OIDC, M6.4 enforce SSO,
M6.5/M6.6 SCIM, M6.7 group mapping) close off their own equivalent
choices.

---

## Rejected in M6.1 (TOTP 2FA)

### 1. WebAuthn / passkeys

**Decision:** Out of scope for M6. Not planned for M6.x.

**Why not now:**

- **Fallback surface doubles the work.** A production WebAuthn flow needs
  a TOTP fallback anyway (users who lose their device, users on a
  browser without a platform authenticator, iCloud-Keychain edge cases,
  cross-device roaming during device replacement). Landing TOTP first
  covers ≥95% of the "2FA?" procurement checklist question without
  requiring the WebAuthn implementation to exist.
- **Attestation storage is non-trivial.** Public keys, credential ids,
  transports, backup-eligibility flags, sign counters — a real
  `WebAuthnCredential` table with proper rotation semantics is
  meaningfully larger than the two columns TOTP added to
  `AuthCredential`.
- **Enterprise procurement doesn't ask for it.** The M6 doc's opening
  sentence is "enterprise procurement asks 'do you support SSO?'" —
  passkeys are a nice-to-have that customers ask for after they've
  bought.

**When to reopen:** After M6.2–M6.6 ship (SSO is what actually closes
enterprise deals). WebAuthn becomes a natural M6.8-or-later.

### 2. SMS 2FA

**Decision:** Explicitly and permanently rejected. Not "later" — no.

**Why not, ever:**

- **SIM-swap risk.** SMS is the single 2FA factor with a known,
  well-documented takeover path (Reddit, Instagram, Coinbase all lost
  accounts to SIM-swap in 2019–2022 when SMS was one of their factors).
- **NIST SP 800-63B**: SMS is deprecated as an authenticator (RESTRICTED
  since 2017 revision).
- **The obvious enterprise path** — customers who need cross-device
  factor without a TOTP app — is SSO+IdP-side MFA. Their IdP already
  handles Duo/Okta Verify/Microsoft Authenticator, and M6.2 lets them
  configure that as the enforced factor at their end. Duplicating
  it Support-side would be worse than what their IdP provides.
- **Cost.** SMS costs real money at scale, unlike TOTP.

**When to reopen:** Never in this form. If we ever add "phone-based
second factor," it will be a WebAuthn credential bound to the phone
(passkey), not SMS.

### 3. Email-recovery link for lost 2FA

**Decision:** Deliberately not added. Backup codes are the recovery
path; when those are also lost, it's a Super Admin unlock ticket
(promote/impersonate flow from M21.7).

**Why not:**

- **It defeats the second factor.** If the recovery path is "we email
  you a link to sign in without your 2FA code," then anyone who
  compromises the mailbox — the exact threat 2FA was added to defend
  against — gets around 2FA at will. Every account with 2FA + email
  recovery is functionally an account with email-only auth.
- **Google, Microsoft, GitHub all reached the same conclusion.** They
  either have no email-recovery-for-2FA (Google, GitHub) or have
  extreme rate-limits + delay windows around it (Microsoft's account
  recovery has multi-day cooling-off periods). Copying either camp
  requires more infrastructure than the current M6.1 problem needs.
- **We already have the right recovery path.** Backup codes cover
  "user lost their device but still has their password + codes."
  Super Admin unlock via M21.7 covers "user lost their codes AND
  their device." A tenant-admin escalation for a small business is
  fine; a tenant that runs a self-serve consumer product with no
  admin oversight would need a different answer, but that's not what
  Stralis Support ships.

**When to reopen:** Only if a compensating control (e.g. hardware-key
verification, video-call identity attestation, or a strict N-day delay
gate) is designed alongside it. "Just an email link" stays rejected.

### 4. Per-tenant envelope encryption — reopened and closed in M6.1.a

The M6.1 spec deferred per-tenant envelope keys to M6.2 (SAML certs).
That deferral was **overturned** during the M6.1 completion pass:
envelope encryption landed in M6.1.a alongside the initial TOTP ship
because SAML/SCIM will need the same primitive, and lifting it into
its own tranche was cleaner than a second migration when M6.2 shipped.
See `src/core/auth/envelope-crypto.ts`.

### 5. Enforce-2FA tenant-wide — reopened and closed in M6.1.b

The M6.1 spec deferred the enforcement toggle to M6.4 (co-located with
SSO-enforce). That deferral was **overturned** in M6.1.b: the toggle
lives in the M6.1 pass because the machinery it needs
(forced-enrollment flow, break-glass invariant, admin control) is
independent of SSO. When M6.4 lands the SSO-enforce toggle, it will
sit next to this one on the same admin page (`/admin/security`) but
under its own column.

---

## Rejected pre-M6.2 (SSO — placeholders, filled in as scoping happens)

*(none yet — will populate as M6.2 scoping surfaces its own trade-offs.)*
