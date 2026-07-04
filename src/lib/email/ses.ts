import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";

/**
 * Outbound email transport (src/lib/email/send.ts's deliver(),
 * lib/inngest/functions/retry-email.ts). Inbound receiving still goes
 * through Resend (src/lib/email/inbound-handler.ts) — SES inbound needs its
 * own MX/S3/SNS setup, out of scope here.
 *
 * AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY are optional: set them for local
 * dev (an IAM user's static keys), but omit them in production if the host
 * (App Runner/ECS) has an IAM task role with ses:SendEmail — the SDK's
 * default credential provider chain picks that up automatically.
 */
const region = process.env.AWS_SES_REGION;

export const sesClient = region
  ? new SESv2Client({
      region,
      ...(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
        ? {
            credentials: {
              accessKeyId: process.env.AWS_ACCESS_KEY_ID,
              secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
            },
          }
        : {}),
    })
  : null;

export async function sendViaSes(from: string, to: string, subject: string, html: string): Promise<void> {
  if (!sesClient) throw new Error("SES not configured (AWS_SES_REGION unset)");
  await sesClient.send(
    new SendEmailCommand({
      FromEmailAddress: from,
      Destination: { ToAddresses: [to] },
      Content: {
        Simple: {
          Subject: { Data: subject, Charset: "UTF-8" },
          Body: { Html: { Data: html, Charset: "UTF-8" } },
        },
      },
    })
  );
}
