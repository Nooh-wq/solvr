"use server";

// Z10.4 — sign a per-organization dashboard share link. Distinct purpose
// from the generic analytics_share so a broader link can never be
// substituted (spec §3: the organizationId lives in the JWT, and the
// verifier ignores any ?organizationId= URL param).

import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { signPurposeToken } from "@/core/auth/tokens";
import { withRls } from "@/lib/db";

const createSchema = z.object({
  organizationId: z.string().min(1),
  days: z.number().int().min(1).max(90).default(30),
});

function siteUrl() {
  return process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
}

export async function createOrgShareLink(input: z.infer<typeof createSchema>) {
  const session = await requireSession({ minRole: "ADMIN" });
  const data = createSchema.parse(input);

  // Defense in depth: the org must belong to the acting tenant. The
  // requireSession already scopes, but confirm the org exists under
  // this tenant before minting a token bound to it.
  const org = await withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    (tx) =>
      tx.organization.findFirst({
        where: { id: data.organizationId, tenantId: session.tenantId },
        select: { id: true },
      })
  );
  if (!org) throw new Error("Organization not found");

  const token = await signPurposeToken(
    "org_analytics_share",
    { tenantId: session.tenantId, organizationId: org.id },
    { ttlSeconds: data.days * 24 * 60 * 60 }
  );

  const expiresAt = new Date(Date.now() + data.days * 24 * 60 * 60 * 1000).toISOString();
  return {
    token,
    url: `${siteUrl()}/share/org/${encodeURIComponent(token)}`,
    expiresAt,
  };
}
