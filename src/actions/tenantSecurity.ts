"use server";

// M6.1.b — tenant security settings actions.
//
// Currently one setting: enforceMfa. Break-glass invariant is enforced
// here rather than at the schema layer because the guarding property is
// operator-relative ("the acting Super Admin must have MFA enrolled
// themselves") — a DB-level check would require reading the caller's
// mfaEnabledAt inside every write, which is easier to express in the
// action layer.

import { z } from "zod";
import { withRls } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { roleToSubjectKind } from "@/lib/z1-dual-fk";

const setEnforceSchema = z.object({ enabled: z.boolean() });

/**
 * Toggles the tenant-wide MFA-enforcement flag.
 *
 * Guardrails:
 *   - Requires SUPER_ADMIN.
 *   - When ENABLING: the acting admin MUST have MFA enrolled themselves,
 *     otherwise they lock themselves out on the next request (their own
 *     session survives, but every other cookie-holder in the tenant
 *     with no MFA enrolled will be forced through enrollment on next
 *     login — including this admin if they sign out and back in).
 *   - When DISABLING: no break-glass required. Turning enforcement OFF
 *     is a strictly de-restricting operation; individual users who have
 *     enrolled 2FA keep it (mfaEnabledAt is unchanged), it just stops
 *     being mandatory for everyone else.
 *
 * Audit surface: this is intentionally a plain lifecycle-column update.
 * A dedicated audit-log entry can be filed in a follow-up if legal /
 * SOC2 evidence asks for it; the schema hook is straightforward and
 * the log surface is already stable.
 */
export async function setTenantMfaEnforcement(
  input: z.infer<typeof setEnforceSchema>
): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = setEnforceSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input." };
  const session = await requireSession({ minRole: "SUPER_ADMIN" });

  if (parsed.data.enabled) {
    // Break-glass: verify the caller has MFA enrolled.
    const callerHasMfa = await withRls(
      { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
      async (tx) => {
        const subjectField = roleToSubjectKind(session.role) === "END_USER"
          ? "subjectEndUserId"
          : "subjectTeamMemberId";
        const cred = await tx.authCredential.findFirst({
          where: { tenantId: session.tenantId, [subjectField]: session.subjectId },
          select: { mfaEnabledAt: true },
        });
        return !!cred?.mfaEnabledAt;
      }
    );
    if (!callerHasMfa) {
      return {
        ok: false,
        error: "Enable 2FA on your own account first — otherwise turning this on would lock you out on next sign-in.",
      };
    }
  }

  await withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    (tx) =>
      tx.tenant.update({
        where: { id: session.tenantId },
        data: { enforceMfa: parsed.data.enabled },
      })
  );
  return { ok: true };
}

const setEnforceSsoSchema = z.object({ enabled: z.boolean() });

/**
 * M6.4 — tenant-wide SSO enforcement.
 *
 * Guardrails:
 *   - Requires SUPER_ADMIN.
 *   - Enabling requires at least one AuthCredential.isBreakGlass = true
 *     Super Admin in the tenant. If a live SAML/OIDC misconfig later
 *     locks everyone out, that break-glass account can still email/
 *     password login and fix the IdP config.
 *   - Enabling also requires at least one active identity provider
 *     (SAML or OIDC), otherwise the tenant has no way to sign in at all.
 *   - Disabling is unguarded (strictly de-restricting).
 */
export async function setTenantSsoEnforcement(
  input: z.infer<typeof setEnforceSsoSchema>
): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = setEnforceSsoSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input." };
  const session = await requireSession({ minRole: "SUPER_ADMIN" });

  if (parsed.data.enabled) {
    const check = await withRls(
      { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
      async (tx) => {
        const breakGlassCount = await tx.authCredential.count({
          where: {
            tenantId: session.tenantId,
            isBreakGlass: true,
            subjectTeamMemberId: { not: null },
          },
        });
        const activeIdp = await tx.tenantIdentityProvider.findFirst({
          where: { tenantId: session.tenantId, isActive: true },
          select: { id: true },
        });
        return { breakGlassCount, hasActiveIdp: !!activeIdp };
      }
    );
    if (!check.hasActiveIdp) {
      return {
        ok: false,
        error: "Configure and activate a SAML or OIDC identity provider first.",
      };
    }
    if (check.breakGlassCount === 0) {
      return {
        ok: false,
        error: "Flag at least one Super Admin as break-glass first — otherwise an IdP misconfiguration will lock this tenant out.",
      };
    }
  }

  await withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    (tx) =>
      tx.tenant.update({
        where: { id: session.tenantId },
        data: { enforceSso: parsed.data.enabled },
      })
  );
  return { ok: true };
}

const setBreakGlassSchema = z.object({
  targetSubjectId: z.string().min(1),
  isBreakGlass: z.boolean(),
});

/**
 * Flags a specific Super Admin as break-glass. The break-glass user's
 * email/password login stays valid even when the tenant enforces SSO —
 * their credential path bypasses the enforceSso branch in login().
 *
 * Requires SUPER_ADMIN. Additional invariant: cannot un-flag the LAST
 * break-glass account when enforceSso is on (that would strand the
 * tenant on the next IdP misconfig).
 */
export async function setBreakGlass(
  input: z.infer<typeof setBreakGlassSchema>
): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = setBreakGlassSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input." };
  const session = await requireSession({ minRole: "SUPER_ADMIN" });

  return withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    async (tx) => {
      // Target must be a Super Admin in this tenant.
      const target = await tx.teamMember.findFirst({
        where: { id: parsed.data.targetSubjectId, tenantId: session.tenantId },
        include: { role: { select: { name: true } } },
      });
      if (!target || target.role.name !== "Super Admin") {
        return { ok: false as const, error: "Break-glass can only be granted to Super Admins." };
      }

      if (!parsed.data.isBreakGlass) {
        // Guard: can't un-flag the last one when enforceSso is on.
        const tenant = await tx.tenant.findUnique({
          where: { id: session.tenantId },
          select: { enforceSso: true },
        });
        if (tenant?.enforceSso) {
          const remaining = await tx.authCredential.count({
            where: {
              tenantId: session.tenantId,
              isBreakGlass: true,
              subjectTeamMemberId: { not: parsed.data.targetSubjectId },
              AND: { subjectTeamMemberId: { not: null } },
            },
          });
          if (remaining === 0) {
            return {
              ok: false as const,
              error: "Cannot remove the last break-glass while SSO is enforced. Disable SSO enforcement first.",
            };
          }
        }
      }

      await tx.authCredential.updateMany({
        where: { tenantId: session.tenantId, subjectTeamMemberId: parsed.data.targetSubjectId },
        data: { isBreakGlass: parsed.data.isBreakGlass },
      });
      return { ok: true as const };
    }
  );
}

/**
 * Reads the tenant's current security settings for the admin page.
 * Also returns whether the acting admin has MFA enrolled — the UI
 * needs it to disable the toggle with a helpful message rather than
 * letting the user click "Enable" and hit the guard.
 */
export async function getTenantSecuritySettings(): Promise<{
  enforceMfa: boolean;
  enforceSso: boolean;
  callerHasMfa: boolean;
  breakGlassCount: number;
  activeIdpKinds: string[];
}> {
  const session = await requireSession({ minRole: "SUPER_ADMIN" });
  return withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    async (tx) => {
      const [tenant, cred, breakGlassCount, activeIdps] = await Promise.all([
        tx.tenant.findUnique({
          where: { id: session.tenantId },
          select: { enforceMfa: true, enforceSso: true },
        }),
        (async () => {
          const subjectField = roleToSubjectKind(session.role) === "END_USER"
            ? "subjectEndUserId"
            : "subjectTeamMemberId";
          return tx.authCredential.findFirst({
            where: { tenantId: session.tenantId, [subjectField]: session.subjectId },
            select: { mfaEnabledAt: true },
          });
        })(),
        tx.authCredential.count({
          where: {
            tenantId: session.tenantId,
            isBreakGlass: true,
            subjectTeamMemberId: { not: null },
          },
        }),
        tx.tenantIdentityProvider.findMany({
          where: { tenantId: session.tenantId, isActive: true },
          select: { kind: true },
        }),
      ]);
      return {
        enforceMfa: tenant?.enforceMfa ?? false,
        enforceSso: tenant?.enforceSso ?? false,
        callerHasMfa: !!cred?.mfaEnabledAt,
        breakGlassCount,
        activeIdpKinds: activeIdps.map((i) => i.kind),
      };
    }
  );
}
