"use server";

// M21.3 — session + login-history actions surfaced by the Security tab.
//
//   * listMySessions          → rows for the current subject, sorted by
//                                lastActiveAt desc; "this device" is
//                                identified by the sessionId claim on the
//                                caller's own cookie.
//   * revokeMySession         → deletes one row; if it's the caller's own
//                                session, they're signed out on next request.
//   * revokeAllOtherSessions  → keeps only the caller's current session.
//   * listMyLoginHistory      → last 20 login rows, newest first.

import { revalidatePath } from "next/cache";
import { withRls } from "@/lib/db";
import { requireSession } from "@/lib/auth";

function parseUserAgent(raw: string | null): { device: string; browser: string } {
  if (!raw) return { device: "Unknown device", browser: "" };
  // Very coarse heuristics — a real UA parser is overkill for a display
  // string. Order matters: mobile checks first, else fall through.
  const ua = raw.toLowerCase();
  let device: string;
  if (ua.includes("iphone")) device = "iPhone";
  else if (ua.includes("ipad")) device = "iPad";
  else if (ua.includes("android")) device = "Android";
  else if (ua.includes("windows")) device = "Windows";
  else if (ua.includes("mac os") || ua.includes("macintosh")) device = "Mac";
  else if (ua.includes("linux")) device = "Linux";
  else device = "Unknown device";

  let browser: string;
  if (ua.includes("edg/")) browser = "Edge";
  else if (ua.includes("chrome/") && !ua.includes("chromium")) browser = "Chrome";
  else if (ua.includes("firefox/")) browser = "Firefox";
  else if (ua.includes("safari/") && !ua.includes("chrome")) browser = "Safari";
  else browser = "";

  return { device, browser };
}

export type SessionRow = {
  id: string;
  device: string;
  browser: string;
  ipAddress: string | null;
  createdAt: Date;
  lastActiveAt: Date;
  isCurrent: boolean;
};

export async function listMySessions(): Promise<SessionRow[]> {
  const session = await requireSession();
  const rows = await withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    (tx) =>
      tx.userSession.findMany({
        where: {
          tenantId: session.tenantId,
          subjectId: session.subjectId,
          expiresAt: { gt: new Date() },
        },
        orderBy: { lastActiveAt: "desc" },
      })
  );
  return rows.map((r) => {
    const { device, browser } = parseUserAgent(r.userAgent);
    return {
      id: r.id,
      device,
      browser,
      ipAddress: r.ipAddress,
      createdAt: r.createdAt,
      lastActiveAt: r.lastActiveAt,
      isCurrent: r.id === session.sessionId,
    };
  });
}

export async function revokeMySession(sessionId: string): Promise<{ ok: true } | { error: string }> {
  if (!sessionId || typeof sessionId !== "string") return { error: "Invalid session." };
  const session = await requireSession();
  const result = await withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    async (tx) => {
      // Bounded to this subject's rows so a malicious id from another
      // subject can't be revoked — RLS already isolates tenant, and the
      // subjectId filter locks it to the caller.
      const r = await tx.userSession.deleteMany({
        where: {
          id: sessionId,
          tenantId: session.tenantId,
          subjectId: session.subjectId,
        },
      });
      return r.count;
    }
  );
  if (result === 0) return { error: "That session is no longer active." };
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function revokeAllOtherSessions(): Promise<{ ok: true; revoked: number }> {
  const session = await requireSession();
  const revoked = await withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    async (tx) => {
      const r = await tx.userSession.deleteMany({
        where: {
          tenantId: session.tenantId,
          subjectId: session.subjectId,
          NOT: { id: session.sessionId },
        },
      });
      return r.count;
    }
  );
  revalidatePath("/", "layout");
  return { ok: true, revoked };
}

export type LoginActivityRow = {
  id: string;
  device: string;
  browser: string;
  ipAddress: string | null;
  country: string | null;
  createdAt: Date;
};

export async function listMyLoginHistory(): Promise<LoginActivityRow[]> {
  const session = await requireSession();
  const rows = await withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    (tx) =>
      tx.loginActivity.findMany({
        where: { tenantId: session.tenantId, subjectId: session.subjectId },
        orderBy: { createdAt: "desc" },
        take: 20,
      })
  );
  return rows.map((r) => {
    const { device, browser } = parseUserAgent(r.userAgent);
    return {
      id: r.id,
      device,
      browser,
      ipAddress: r.ipAddress,
      country: r.country,
      createdAt: r.createdAt,
    };
  });
}
