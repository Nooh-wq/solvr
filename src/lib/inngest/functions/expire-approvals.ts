// src/lib/inngest/functions/expire-approvals.ts
//
// M15.3 — hourly cron that expires stale ApprovalRequest rows. Spec §3
// pin: "Do NOT let approvals silently expire." — every expiration
// emits an AuditLog row, which M1 rules can trigger on to escalate.
// The status flip itself is the signal; downstream escalation is a
// tenant-side concern via existing rule triggers.

import { inngest } from "../client";
import { expireStaleApprovals } from "@/actions/approvalRequests";

export const expireApprovals = inngest.createFunction(
  { id: "expire-approvals", triggers: { cron: "0 * * * *" } }, // hourly
  async () => {
    const { expired } = await expireStaleApprovals();
    return { expired };
  }
);
