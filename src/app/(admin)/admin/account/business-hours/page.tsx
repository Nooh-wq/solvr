import Link from "next/link";
import { requireSession } from "@/lib/auth";
import { withRls } from "@/lib/db";
import { getAccountSettings } from "@/actions/accountSettings";
import { EmptyState } from "@/components/empty-state";
import { DefaultCalendarPicker } from "./default-calendar-picker";

export const dynamic = "force-dynamic";

export default async function BusinessHoursPage() {
  const session = await requireSession({ minRole: "ADMIN" });
  const [settings, calendars] = await Promise.all([
    getAccountSettings(),
    withRls(
      { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
      (tx) =>
        tx.businessCalendar.findMany({
          where: { tenantId: session.tenantId },
          orderBy: { name: "asc" },
          select: { id: true, name: true, timezone: true, isDefault: true },
        })
    ),
  ]);

  return (
    <div>
      <h1 className="text-2xl font-bold mb-1">Business hours</h1>
      <p className="text-sm text-[var(--color-neutral-600)] mb-6 max-w-2xl">
        Working days, working hours, and holidays. Feeds SLA calculations and shows agents when
        they&apos;re on/off the clock. Pick a workspace default here; SLA policies and specific
        organizations can override it.
      </p>

      <div className="space-y-6 max-w-3xl">
        <section>
          <h2 className="text-[15px] font-semibold mb-2">Workspace default</h2>
          {calendars.length === 0 ? (
            <EmptyState
              title="No calendars yet"
              description="Create a business calendar first, then choose which one is the workspace default."
              primaryCta={{ label: "Create calendar", href: "/admin/business-calendars" }}
            />
          ) : (
            <DefaultCalendarPicker
              initialSelected={settings.defaultBusinessCalendarId}
              calendars={calendars}
            />
          )}
        </section>

        {calendars.length > 0 ? (
          <section>
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-[15px] font-semibold">All calendars</h2>
              <Link
                href="/admin/business-calendars"
                className="text-[12px] font-medium px-3 py-1.5 rounded-lg border border-[var(--color-neutral-300)] hover:bg-[var(--color-neutral-100)]"
              >
                Manage
              </Link>
            </div>
            <div className="bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-[var(--color-light-gray)] text-[11px] uppercase-label text-[var(--color-neutral-700)]">
                  <tr>
                    <th className="text-left font-semibold px-4 py-2.5">Name</th>
                    <th className="text-left font-semibold px-4 py-2.5">Timezone</th>
                    <th className="text-left font-semibold px-4 py-2.5">Role</th>
                  </tr>
                </thead>
                <tbody>
                  {calendars.map((c) => (
                    <tr key={c.id} className="border-t border-[var(--color-neutral-100)]">
                      <td className="px-4 py-3 font-medium">{c.name}</td>
                      <td className="px-4 py-3 font-mono text-[12px]">{c.timezone}</td>
                      <td className="px-4 py-3">
                        {settings.defaultBusinessCalendarId === c.id ? (
                          <span className="text-[11px] uppercase-label px-2 py-0.5 rounded-full bg-[var(--color-primary)]/10 text-[var(--color-primary)]">
                            Workspace default
                          </span>
                        ) : c.isDefault ? (
                          <span className="text-[11px] uppercase-label px-2 py-0.5 rounded-full bg-[var(--color-neutral-100)]">
                            Legacy default
                          </span>
                        ) : (
                          <span className="text-[11px] text-[var(--color-neutral-500)]">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}
      </div>
    </div>
  );
}
