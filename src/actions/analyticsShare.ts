"use server";

import { z } from "zod";
import { requireSession } from "@/lib/auth";
// B7.4: no cookie R/W in this file — signAnalyticsShareToken fully
// migrates. Purpose literal stays "analytics_share" (snake_case)
// verbatim per §7.16 — every 30-day live share link in customer
// inboxes carries that exact claim value.
import { signPurposeToken } from "@/core/auth/tokens";
import { analyticsFilterSchema } from "@/lib/validation/admin";

// M13 gap 2 — create a read-only, signed share URL for the current
// analytics filter combination. Admin-gated at creation time; the
// resulting URL requires no login (verified via the HMAC token).

const createSchema = z.object({
  filters: analyticsFilterSchema,
});

function siteUrl() {
  return process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
}

export async function createShareLink(input: z.infer<typeof createSchema>) {
  const session = await requireSession({ minRole: "ADMIN" });
  const { filters } = createSchema.parse(input);
  const token = await signPurposeToken("analytics_share", {
    tenantId: session.tenantId,
    filters,
  });
  return {
    token,
    url: `${siteUrl()}/reports/shared/${encodeURIComponent(token)}`,
  };
}
