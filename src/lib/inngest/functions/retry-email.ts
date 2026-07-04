import { sesClient, sendViaSes } from "@/lib/email/ses";
import { inngest } from "../client";

export type EmailSendFailedEvent = {
  name: "email/send.failed";
  data: { from: string; to: string; subject: string; html: string };
};

/**
 * Backstop retry for email sends that failed on the first (synchronous)
 * attempt — see the catch block in src/lib/email/send.ts's deliver(). Inngest
 * retries this function automatically (3x, exponential backoff) if it throws.
 * Requires `npx inngest-cli dev` running locally to actually execute (see
 * README "Background jobs").
 */
export const retryEmailSend = inngest.createFunction(
  { id: "retry-email-send", retries: 3, triggers: { event: "email/send.failed" } },
  async ({ event, step }) => {
    await step.run("send-email", async () => {
      if (!sesClient) {
        // Nothing more we can do without SES configured — don't retry forever.
        console.log(`[email:retry skipped, SES not configured] to=${event.data.to} subject="${event.data.subject}"`);
        return;
      }
      await sendViaSes(event.data.from, event.data.to, event.data.subject, event.data.html);
    });
  }
);
