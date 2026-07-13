import { serve } from "inngest/next";
import { inngest } from "@/lib/inngest/client";
import { retryEmailSend } from "@/lib/inngest/functions/retry-email";
import { autoCloseResolvedTickets } from "@/lib/inngest/functions/auto-close";
import { sendDailyDigests } from "@/lib/inngest/functions/send-daily-digests";
import { buildDataExport } from "@/lib/inngest/functions/build-data-export";
import { runScheduledAutomations } from "@/lib/inngest/functions/run-automations";
import { emitSlaEvents } from "@/lib/inngest/functions/emit-sla-events";
import { sendCsatQueue } from "@/lib/inngest/functions/send-csat-queue";
import { buildTicketRollup } from "@/lib/inngest/functions/build-ticket-rollup";
import { sendReportSchedules } from "@/lib/inngest/functions/send-report-schedules";
import { deliverWebhook } from "@/lib/inngest/functions/deliver-webhook";
import { classifyMessageFn } from "@/lib/inngest/functions/classify-message";
import { clusterKbSuggestions } from "@/lib/inngest/functions/cluster-kb-suggestions";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    retryEmailSend,
    autoCloseResolvedTickets,
    sendDailyDigests,
    buildDataExport,
    runScheduledAutomations,
    emitSlaEvents,
    sendCsatQueue,
    buildTicketRollup,
    sendReportSchedules,
    deliverWebhook,
    classifyMessageFn,
    clusterKbSuggestions,
  ],
});
