import { listTriggers } from "@/actions/rules";
import { TriggersEditor } from "./editor";

export default async function TriggersPage() {
  const rows = await listTriggers();
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-[var(--foreground)]">Triggers</h1>
        <p className="mt-2 text-[13px] text-[var(--color-neutral-600)] max-w-2xl">
          Fire inline on ticket events (created, updated, replied, status/priority changed).
          Each event only loads its own triggers; execution is capped at 10 rules per event
          to break loops.
        </p>
      </div>
      <TriggersEditor
        initialRows={rows.map((r) => ({
          id: r.id,
          name: r.name,
          description: r.description,
          triggerEvent: r.triggerEvent!,
          conditions: r.conditions,
          actions: r.actions,
          active: r.active,
          lastRunAt: r.lastRunAt ? r.lastRunAt.toISOString() : null,
        }))}
      />
    </div>
  );
}
