import { serve } from "inngest/next";
import { inngest } from "@/lib/inngest/client";
import { retryEmailSend } from "@/lib/inngest/functions/retry-email";
import { autoCloseResolvedTickets } from "@/lib/inngest/functions/auto-close";
import { sendDailyDigests } from "@/lib/inngest/functions/send-daily-digests";
import { buildDataExport } from "@/lib/inngest/functions/build-data-export";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [retryEmailSend, autoCloseResolvedTickets, sendDailyDigests, buildDataExport],
});
