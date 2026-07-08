// M21.3 — thin helper for the append-only login history. Called after
// every session-minting event (login, password-reset confirm, invite
// accept + OTP verify, tenant signup). Kept as its own module so it
// can be imported from both server actions and route handlers without
// pulling the entire session-cookie machinery.

import { headers } from "next/headers";
import geoip from "geoip-lite";
import { withRls } from "@/lib/db";
import type { SubjectKind } from "@/lib/session";

export async function recordLoginActivity(input: {
  tenantId: string;
  subjectId: string;
  subjectKind: SubjectKind;
}) {
  try {
    const h = await headers();
    const forwardedFor = h.get("x-forwarded-for");
    const ip = forwardedFor
      ? forwardedFor.split(",")[0].trim()
      : (h.get("x-real-ip") ?? null);
    const ipAddress = ip && ip !== "unknown" ? ip : null;
    const userAgent = h.get("user-agent");
    // Country is best-effort — geoip-lite ships an offline table, no
    // outbound call. Locally-served requests resolve to null.
    const country = ipAddress ? (geoip.lookup(ipAddress)?.country ?? null) : null;
    await withRls(
      { tenantId: input.tenantId, userId: input.subjectId, role: "SUPER_ADMIN" },
      (tx) =>
        tx.loginActivity.create({
          data: {
            tenantId: input.tenantId,
            subjectId: input.subjectId,
            subjectKind: input.subjectKind,
            userAgent,
            ipAddress,
            country,
          },
        })
    );
  } catch {
    // Non-fatal. Recording history must never block a valid login.
  }
}
