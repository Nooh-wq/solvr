import { serve } from "inngest/next";
import { inngest } from "@/lib/inngest/client";
import { retryEmailSend } from "@/lib/inngest/functions/retry-email";
import { autoCloseResolvedTickets } from "@/lib/inngest/functions/auto-close";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [retryEmailSend, autoCloseResolvedTickets],
});
