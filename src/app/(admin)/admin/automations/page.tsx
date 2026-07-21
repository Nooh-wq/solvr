import { listAutomations } from "@/actions/rules";
import { AutomationsEditor } from "./editor";

export default async function AutomationsPage() {
  const rows = await listAutomations();
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-[var(--foreground)]">Automations</h1>
        <p className="mt-2 text-[13px] text-[var(--color-neutral-600)] max-w-2xl">
          Scheduled scans — for anything you&apos;d normally check by hand, on a schedule.
          Example: every 24h, find PENDING tickets untouched more than 48h and post an
          internal note nudging the assignee.
        </p>
        <p className="mt-1 text-[11px] text-[var(--color-neutral-500)]">
          Batch-processed, capped at 500 tickets per run. Use &quot;Run now&quot; to test.
          Automatic scheduling arrives with the Inngest cron in a follow-up.
        </p>
      </div>
      <AutomationsEditor
        initialRows={rows.map((r) => ({
          id: r.id,
          name: r.name,
          description: r.description,
          intervalHours: r.intervalHours ?? 24,
          conditions: r.conditions,
          actions: r.actions,
          active: r.active,
          lastRunAt: r.lastRunAt ? r.lastRunAt.toISOString() : null,
        }))}
      />
    </div>
  );
}
