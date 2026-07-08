import Link from "next/link";
import { notFound } from "next/navigation";
import { loadOrganizationDetail } from "@/actions/organizations";
import { listValuesForTarget } from "@/actions/customFields";
import { CustomFieldsEditor } from "@/components/custom-fields-editor";
import { OrgNotesEditor } from "./notes-editor";
import { OrgActionsMenu } from "./actions-menu";
import { SlaBusinessHoursStub } from "./sla-stub";
import { listSlaPolicies, listBusinessCalendars } from "@/actions/sla";
import { StatusBadge, PriorityLabel } from "@/components/ui/badge";
import { requireSession } from "@/lib/auth";
import { withRls } from "@/lib/db";

// Z4.2 — Organization detail. Users + tickets + tags + custom fields
// + notes, plus disabled SLA/BH stubs (Z4.5).

export default async function OrganizationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const org = await loadOrganizationDetail(id);
  if (!org) notFound();

  const customFields = await listValuesForTarget("ORG", org.id);
  // M2.6 — load tenant's SLA + calendar options to populate the override dropdowns.
  // Empty arrays render as "no policies yet, create one first" hint in the component.
  const [policies, calendars] = await Promise.all([
    listSlaPolicies().catch(() => []),
    listBusinessCalendars().catch(() => []),
  ]);

  // M5.2 — CSAT rollup for this org. Aggregates over VISIBLE + FLAGGED
  // rows (HIDDEN comments still count toward avg; hidden = comment
  // moderation, not rating exclusion). NPS and CSAT scores stay in the
  // same avg because the surveyType label makes the scale explicit.
  const session = await requireSession({ minRole: "ADMIN" });
  const csat = await withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    async (tx) => {
      const rows = await tx.surveyResponse.findMany({
        where: {
          tenantId: session.tenantId,
          ticket: { organizationId: org.id },
        },
        select: { rating: true, surveyType: true },
      });
      if (rows.length === 0) return null;
      const byType = { CSAT: { sum: 0, n: 0 }, NPS: { sum: 0, n: 0 } };
      for (const r of rows) {
        byType[r.surveyType].sum += r.rating;
        byType[r.surveyType].n += 1;
      }
      return {
        total: rows.length,
        csat: byType.CSAT.n ? byType.CSAT.sum / byType.CSAT.n : null,
        nps: byType.NPS.n ? byType.NPS.sum / byType.NPS.n : null,
      };
    }
  );

  return (
    <div>
      <div className="mb-4 text-[12px] text-[var(--color-neutral-500)]">
        <Link href="/admin/organizations" className="hover:text-[var(--foreground)]">
          ← Back to organizations
        </Link>
      </div>

      {/* Header card */}
      <div className="bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl p-6 mb-6">
        <div className="flex items-start gap-4">
          <div className="h-16 w-16 rounded-2xl bg-[var(--color-primary)]/10 text-[var(--color-primary)] text-2xl font-semibold flex items-center justify-center">
            {org.name.slice(0, 2).toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-2xl font-bold truncate">{org.name}</h1>
            {org.domain && (
              <div className="text-[13px] text-[var(--color-neutral-600)] mt-0.5">
                {org.domain}
              </div>
            )}
            {org.tags.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-2">
                {org.tags.map((t) => (
                  <span
                    key={t.id}
                    className="px-1.5 py-0.5 rounded text-[10px] font-medium"
                    style={{ backgroundColor: `${t.color}22`, color: t.color }}
                  >
                    {t.name}
                  </span>
                ))}
              </div>
            )}
          </div>
          <div className="text-right text-[12px] text-[var(--color-neutral-500)]">
            <div>
              <span className="text-[var(--color-neutral-600)] font-medium">{org.users.length}</span> users
            </div>
            <div>
              <span className="text-[var(--color-neutral-600)] font-medium">{org.openTicketCount}</span> open tickets
            </div>
            <div className="mt-1 text-[11px]">
              Created {org.createdAt.toLocaleDateString()}
            </div>
          </div>
          <OrgActionsMenu organizationId={org.id} organizationName={org.name} />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          {/* Users list */}
          <div className="bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl p-5">
            <h2 className="text-[13px] font-semibold mb-3">Users ({org.users.length})</h2>
            {org.users.length === 0 ? (
              <div className="text-[13px] text-[var(--color-neutral-500)] py-4">
                No users linked to this organization yet.
              </div>
            ) : (
              <ul className="divide-y divide-[var(--color-neutral-200)] dark:divide-white/5 -mx-2">
                {org.users.map((u) => (
                  <li key={u.id} className="px-2 py-2.5 flex items-center gap-3">
                    <Link
                      href={`/admin/users/${u.id}`}
                      className="flex-1 min-w-0 hover:text-[var(--color-primary)]"
                    >
                      <div className="text-[13px] font-medium truncate">{u.name ?? u.email}</div>
                      <div className="text-[11px] text-[var(--color-neutral-500)] flex items-center gap-2">
                        <span className="truncate">{u.email}</span>
                        {!u.isPrimary && (
                          <span className="px-1 py-0.5 rounded bg-[var(--color-neutral-200)] text-[10px] text-[var(--color-neutral-700)]">
                            Secondary
                          </span>
                        )}
                      </div>
                    </Link>
                    <div className="text-[12px] text-[var(--color-neutral-500)] tabular-nums">
                      {u.ticketCount} tickets
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Tickets list */}
          <div className="bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl p-5">
            <h2 className="text-[13px] font-semibold mb-3">Tickets ({org.tickets.length})</h2>
            {org.tickets.length === 0 ? (
              <div className="text-[13px] text-[var(--color-neutral-500)] py-4">
                No tickets from this organization yet.
              </div>
            ) : (
              <ul className="divide-y divide-[var(--color-neutral-200)] dark:divide-white/5 -mx-2">
                {org.tickets.map((t) => (
                  <li key={t.id} className="px-2 py-2.5">
                    <Link
                      href={`/agent/tickets/${t.id}`}
                      className="flex items-center gap-3 group"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="text-[13px] group-hover:text-[var(--color-primary)] truncate">
                          <span className="text-[var(--color-neutral-500)] mr-1.5 font-mono text-[11px]">
                            {t.reference}
                          </span>
                          {t.title}
                        </div>
                        <div className="text-[11px] text-[var(--color-neutral-500)] mt-0.5">
                          {t.clientName ?? "—"} · {formatRelative(t.updatedAt)}
                        </div>
                      </div>
                      <PriorityLabel priority={t.priority} />
                      <StatusBadge status={t.status} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="space-y-6">
          <OrgNotesEditor organizationId={org.id} initialNotes={org.notes ?? ""} />

          {customFields.length > 0 && (
            <CustomFieldsEditor title="Custom fields" rows={customFields} targetId={org.id} />
          )}

          {csat && (
            <div className="bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl p-5">
              <h3 className="text-sm font-semibold mb-1">Satisfaction</h3>
              <p className="text-[11px] text-[var(--color-neutral-500)] mb-3">
                Based on {csat.total} response{csat.total === 1 ? "" : "s"} from this organization.
              </p>
              <div className="flex gap-4">
                {csat.csat !== null && (
                  <div>
                    <div className="text-[10px] uppercase tracking-wide text-[var(--color-neutral-500)]">CSAT</div>
                    <div className="text-2xl font-semibold">
                      {csat.csat.toFixed(2)}
                      <span className="text-[13px] text-[var(--color-neutral-500)] font-normal"> / 5</span>
                    </div>
                  </div>
                )}
                {csat.nps !== null && (
                  <div>
                    <div className="text-[10px] uppercase tracking-wide text-[var(--color-neutral-500)]">NPS</div>
                    <div className="text-2xl font-semibold">
                      {csat.nps.toFixed(1)}
                      <span className="text-[13px] text-[var(--color-neutral-500)] font-normal"> / 10</span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          <SlaBusinessHoursStub
            organizationId={org.id}
            slaPolicyId={org.slaPolicyId}
            businessHoursId={org.businessHoursId}
            policies={policies.map((p) => ({ id: p.id, name: p.name, isDefault: p.isDefault }))}
            calendars={calendars.map((c) => ({ id: c.id, name: c.name, timezone: c.timezone, isDefault: c.isDefault }))}
          />
        </div>
      </div>
    </div>
  );
}

function formatRelative(d: Date): string {
  const delta = Date.now() - new Date(d).getTime();
  const day = 86_400_000;
  if (delta < day) return "today";
  if (delta < day * 2) return "yesterday";
  if (delta < day * 30) return `${Math.floor(delta / day)}d ago`;
  return new Date(d).toLocaleDateString();
}
