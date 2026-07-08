// M21.3 — DB-touching helpers for the UserSession row.
//
// Kept in its own module so `src/lib/session.ts` (used from Edge middleware)
// can stay Edge-safe. Anything that needs Prisma or `next/headers` imports
// through this file lives here.

import { headers } from "next/headers";
import { withRls } from "@/lib/db";
import { SESSION_DURATION_SECONDS, type SubjectKind } from "@/lib/session";

async function readClientContext(): Promise<{ userAgent: string | null; ipAddress: string | null }> {
  const h = await headers();
  const forwardedFor = h.get("x-forwarded-for");
  const ip = forwardedFor
    ? forwardedFor.split(",")[0].trim()
    : (h.get("x-real-ip") ?? null);
  return {
    userAgent: h.get("user-agent"),
    ipAddress: ip && ip !== "unknown" ? ip : null,
  };
}

/**
 * Creates a UserSession row for a fresh login and returns its id. Every
 * caller of createSessionCookie (post-M21.3) must first mint an id here
 * so the cookie carries a sessionId claim that getSessionUser can look up.
 */
export async function createUserSession(input: {
  subjectId: string;
  subjectKind: SubjectKind;
  tenantId: string;
}): Promise<string> {
  const id = globalThis.crypto.randomUUID();
  const { userAgent, ipAddress } = await readClientContext();
  const expiresAt = new Date(Date.now() + SESSION_DURATION_SECONDS * 1000);
  await withRls(
    { tenantId: input.tenantId, userId: input.subjectId, role: "SUPER_ADMIN" },
    (tx) =>
      tx.userSession.create({
        data: {
          id,
          tenantId: input.tenantId,
          subjectId: input.subjectId,
          subjectKind: input.subjectKind,
          userAgent,
          ipAddress,
          expiresAt,
        },
      })
  );
  return id;
}
