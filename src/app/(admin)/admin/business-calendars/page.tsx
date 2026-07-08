import { listBusinessCalendars } from "@/actions/sla";
import { BusinessCalendarsEditor } from "./editor";

export default async function BusinessCalendarsPage() {
  const rows = await listBusinessCalendars();
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-[var(--foreground)]">Business calendars</h1>
        <p className="mt-2 text-[13px] text-[var(--color-neutral-600)] max-w-2xl">
          Working hours + holidays used to compute business-hours-adjusted SLA
          due times. One calendar is the tenant default; organizations may
          override with their own via Organizations → Business hours.
        </p>
      </div>
      <BusinessCalendarsEditor
        initialRows={rows.map((r) => ({
          id: r.id,
          name: r.name,
          timezone: r.timezone,
          weeklyHours: r.weeklyHours,
          holidays: r.holidays,
          isDefault: r.isDefault,
        }))}
      />
    </div>
  );
}
