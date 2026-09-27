import { inngest } from "../client";
import { prisma, withRls } from "@/lib/db";
import { sendSystemNotice } from "@/lib/email/send";
import { renderReportCsv } from "@/actions/reports";
import { computeNextRunAt } from "@/lib/report-schedule";
import { analyticsFilterSchema } from "@/lib/validation/admin";

// M13 gap 1 — scheduled report dispatcher. Runs hourly; picks up
// SavedReport rows whose nextRunAt <= now, renders the CSV, emails
// each recipient via the existing sendSystemNotice pipeline (which
// falls back cleanly if no email provider is configured), then
// advances nextRunAt by the frequency + hour.
//
// Failure model matches send-csat-queue: on a render/send failure we
// swallow the exception per-report so one bad row doesn't block the
// batch, but we do NOT advance nextRunAt in that case — the report
// will re-attempt on the next tick. When enough of these pile up, an
// admin sees "lastRunAt is stale despite a schedule" in the list.
//
// CSV is inlined into the email body as a preformatted block. A real
// attachment would need an outbound-email provider that supports
// them uniformly (SES + Resend + local dev). Deferred — for now
// admins hit the "Export CSV" button in-app; the scheduled email
// summarizes + links.

export const sendReportSchedules = inngest.createFunction(
  { id: "send-report-schedules", triggers: { cron: "0 * * * *" } }, // hourly
  async ({ step }) => {
    const now = new Date();

    const dueReports = await step.run("list-due", () =>
      prisma.savedReport.findMany({
        where: {
          nextRunAt: { lte: now },
          scheduleFrequency: { not: "NONE" },
          // Only reports that actually name someone to send to.
          recipientEmails: { isEmpty: false },
        },
        // Fair batch: never dispatch more than 200 in one tick so a
        // pathological backlog can't monopolize the cron window.
        take: 200,
      })
    );

    let sent = 0;
    let failed = 0;
    for (const report of dueReports) {
      try {
        await step.run(`send-${report.id}`, async () => {
          const parsed = analyticsFilterSchema.safeParse(report.filters);
          if (!parsed.success) throw new Error("Filter blob failed validation.");
          const csv = await renderReportCsv(report.tenantId, parsed.data);

          const branding = await withRls(
            { tenantId: report.tenantId, userId: null, role: "SUPER_ADMIN" },
            (tx) => tx.tenantBranding.findUnique({ where: { tenantId: report.tenantId } })
          );

          const rowCount = Math.max(0, csv.split("\n").length - 1);
          const body =
            `Attached below is the "${report.name}" report.\n\n` +
            `Time range: ${parsed.data.range}\n` +
            `Rows: ${rowCount}\n\n` +
            `--- csv ---\n${csv.slice(0, 8000)}${csv.length > 8000 ? "\n… (truncated in this email, run Export CSV in-app for the full file)" : ""}`;

          for (const to of report.recipientEmails) {
            await sendSystemNotice({
              to,
              branding,
              subject: `[Report] ${report.name}`,
              heading: report.name,
              body,
              ctaLabel: "Open dashboard",
              ctaUrl: `${process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"}/admin/reports`,
            });
          }

          const nextRunAt = computeNextRunAt(
            report.scheduleFrequency,
            report.scheduleHour,
            now
          );
          await prisma.savedReport.update({
            where: { id: report.id },
            data: { lastRunAt: now, nextRunAt },
          });
        });
        sent++;
      } catch (e) {
        console.error(`[send-report-schedules] ${report.id}:`, e);
        failed++;
      }
    }
    return { sent, failed, considered: dueReports.length };
  }
);
