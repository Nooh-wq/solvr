import Link from "next/link";
import { requireSession } from "@/lib/auth";
import { withRls } from "@/lib/db";
import { loadCsatSettings } from "@/actions/csatSettings";
import { CsatSettingsForm } from "./settings-form";
import { ModerationActions } from "./moderation-row";

// M5 admin surface. Combines two things a Zendesk admin looks for
// under "CSAT": the delivery settings, and a moderation-friendly
// list of recent survey responses with their comments.

export default async function CsatAdminPage() {
  const session = await requireSession({ minRole: "ADMIN" });
  const settings = await loadCsatSettings();

  // Load the 100 most recent responses. Anything older lives in the
  // per-agent/per-org breakdowns on Analytics; this page is for
  // triaging comments.
  const responses = await withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    async (tx) => {
      const rows = await tx.surveyResponse.findMany({
        where: { tenantId: session.tenantId },
        orderBy: { createdAt: "desc" },
        take: 100,
        select: {
          id: true,
          rating: true,
          comment: true,
          surveyType: true,
          moderationStatus: true,
          createdAt: true,
          ticket: {
            select: { id: true, reference: true, title: true },
          },
        },
      });
      return rows;
    }
  );

  const avgOverall =
    responses.length === 0
      ? null
      : responses.reduce((s, r) => s + r.rating, 0) / responses.length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-[var(--foreground)]">CSAT & Feedback</h1>
        <p className="mt-2 text-[13px] text-[var(--color-neutral-600)] max-w-2xl">
          Configure survey delivery, review recent responses, and moderate
          free-text comments. Hidden comments still count toward the numeric
          average — this only controls display.
        </p>
      </div>

      <CsatSettingsForm initial={settings} />

      <div className="bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--color-neutral-200)]">
          <div>
            <h2 className="text-sm font-semibold">Recent responses</h2>
            <p className="text-[11px] text-[var(--color-neutral-500)]">
              {responses.length === 0
                ? "No responses yet."
                : `${responses.length} shown${
                    avgOverall !== null ? ` · avg ${avgOverall.toFixed(2)}` : ""
                  }`}
            </p>
          </div>
        </div>
        {responses.length === 0 ? (
          <div className="px-5 py-8 text-[13px] text-[var(--color-neutral-500)] italic">
            Ratings and comments will appear here once clients respond.
          </div>
        ) : (
          <ul className="divide-y divide-[var(--color-neutral-200)]">
            {responses.map((r) => {
              const scaleMax = r.surveyType === "NPS" ? 10 : 5;
              return (
                <li key={r.id} className="px-5 py-3">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <Link
                          href={`/agent/tickets/${r.ticket.id}`}
                          className="text-[12px] font-mono text-[var(--color-neutral-500)] hover:text-[var(--foreground)]"
                        >
                          {r.ticket.reference}
                        </Link>
                        <span className="text-[11px] text-[var(--color-neutral-500)]">
                          {r.createdAt.toLocaleString()}
                        </span>
                        <span
                          className={`text-[10px] uppercase tracking-wide rounded-full border px-1.5 py-0.5 ${
                            r.surveyType === "NPS"
                              ? "border-blue-500/40 text-blue-700 dark:text-blue-300"
                              : "border-[var(--color-neutral-300)] text-[var(--color-neutral-600)]"
                          }`}
                        >
                          {r.surveyType}
                        </span>
                        {r.moderationStatus === "FLAGGED" && (
                          <span className="text-[10px] uppercase tracking-wide rounded-full border border-amber-500/50 bg-amber-500/10 text-amber-700 dark:text-amber-300 px-1.5 py-0.5">
                            Flagged
                          </span>
                        )}
                        {r.moderationStatus === "HIDDEN" && (
                          <span className="text-[10px] uppercase tracking-wide rounded-full border border-red-500/50 bg-red-500/10 text-red-700 dark:text-red-300 px-1.5 py-0.5">
                            Hidden
                          </span>
                        )}
                      </div>
                      <div className="text-[13px] font-medium truncate">{r.ticket.title}</div>
                      <div className="text-[13px] mt-1">
                        <span className="font-semibold">{r.rating}</span>
                        <span className="text-[var(--color-neutral-500)]"> / {scaleMax}</span>
                      </div>
                      {r.comment && (
                        <p
                          className={`mt-1 text-[13px] ${
                            r.moderationStatus === "HIDDEN"
                              ? "text-[var(--color-neutral-500)] italic line-through"
                              : "text-[var(--foreground)]"
                          }`}
                        >
                          &ldquo;{r.comment}&rdquo;
                        </p>
                      )}
                    </div>
                    <ModerationActions
                      surveyResponseId={r.id}
                      initialStatus={r.moderationStatus}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
