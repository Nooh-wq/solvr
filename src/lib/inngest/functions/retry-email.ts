import { Resend } from "resend";
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
      if (!process.env.RESEND_API_KEY) {
        // Nothing more we can do without a Resend key — don't retry forever.
        console.log(`[email:retry skipped, no RESEND_API_KEY] to=${event.data.to} subject="${event.data.subject}"`);
        return;
      }
      const resend = new Resend(process.env.RESEND_API_KEY);
      await resend.emails.send({
        from: event.data.from,
        to: event.data.to,
        subject: event.data.subject,
        html: event.data.html,
      });
    });
  }
);
