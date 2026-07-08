"use server";

import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { signAnalyticsShareToken } from "@/lib/session";
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
  const token = await signAnalyticsShareToken({
    tenantId: session.tenantId,
    filters,
  });
  return {
    token,
    url: `${siteUrl()}/reports/shared/${encodeURIComponent(token)}`,
  };
}
