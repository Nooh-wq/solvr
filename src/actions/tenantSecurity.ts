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

/**
 * Reads the tenant's current security settings for the admin page.
 * Also returns whether the acting admin has MFA enrolled — the UI
 * needs it to disable the toggle with a helpful message rather than
 * letting the user click "Enable" and hit the guard.
 */
export async function getTenantSecuritySettings(): Promise<{
  enforceMfa: boolean;
  callerHasMfa: boolean;
}> {
  const session = await requireSession({ minRole: "SUPER_ADMIN" });
  return withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    async (tx) => {
      const [tenant, cred] = await Promise.all([
        tx.tenant.findUnique({
          where: { id: session.tenantId },
          select: { enforceMfa: true },
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
      ]);
      return {
        enforceMfa: tenant?.enforceMfa ?? false,
        callerHasMfa: !!cred?.mfaEnabledAt,
      };
    }
  );
}
