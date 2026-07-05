import { Resend } from "resend";
import { sesClient, sendViaSes } from "@/lib/email/ses";
import { inngest } from "../client";

export type EmailSendFailedEvent = {
  name: "email/send.failed";
  data: { from: string; to: string; subject: string; html: string };
};

/**
 * Backstop retry for email sends that failed on the first (synchronous)
 * attempt — see the catch block in src/lib/email/send.ts's deliver(), which
 * this mirrors: SES first, falling back to Resend while AWS production
 * access is still pending (see deliver()'s comment for why). Inngest retries
 * this function automatically (3x, exponential backoff) if it throws.
 * Requires `npx inngest-cli dev` running locally to actually execute (see
 * README "Background jobs").
 */
export const retryEmailSend = inngest.createFunction(
  { id: "retry-email-send", retries: 3, triggers: { event: "email/send.failed" } },
  async ({ event, step }) => {
    await step.run("send-email", async () => {
      if (sesClient) {
        try {
          await sendViaSes(event.data.from, event.data.to, event.data.subject, event.data.html);
          return;
        } catch (err) {
          console.error("[email:retry via SES failed, trying Resend]", err);
        }
      }

      if (process.env.RESEND_API_KEY) {
        await new Resend(process.env.RESEND_API_KEY).emails.send({
          from: event.data.from,
          to: event.data.to,
          subject: event.data.subject,
          html: event.data.html,
        });
        return;
      }

      // Nothing more we can do without either provider configured — don't retry forever.
      console.log(`[email:retry skipped, no provider configured] to=${event.data.to} subject="${event.data.subject}"`);
    });
  }
);
