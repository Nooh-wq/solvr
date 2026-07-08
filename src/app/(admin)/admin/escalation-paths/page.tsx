import { listEscalationPaths } from "@/actions/escalations";
import { EscalationPathsEditor } from "./editor";

export default async function EscalationPathsPage() {
  const rows = await listEscalationPaths();
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-[var(--foreground)]">Escalation paths</h1>
        <p className="mt-2 text-[13px] text-[var(--color-neutral-600)] max-w-2xl">
          Configurable buttons that appear on the ticket detail. Each path names a
          destination — a group (TEAM), a webhook URL, an email address, or a
          marketplace integration (available once the marketplace ships).
        </p>
        <p className="mt-1 text-[11px] text-[var(--color-neutral-500)]">
          Failed escalations always surface to the agent and land in
          <code className="mx-1 px-1 py-0.5 rounded bg-black/[0.045] dark:bg-white/[0.06] text-[10px]">escalation_logs</code>
          as FAILED — never silent.
        </p>
      </div>
      <EscalationPathsEditor
        initialRows={rows.map((r) => ({
          id: r.id,
          label: r.label,
          icon: r.icon,
          categoryIds: r.categoryIds,
          destKind: r.destKind,
          destConfig: r.destConfig,
          active: r.active,
        }))}
      />
    </div>
  );
}
