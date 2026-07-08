import { listSlaPolicies } from "@/actions/sla";
import { SlaPoliciesEditor } from "./editor";

export default async function SlaPoliciesPage() {
  const rows = await listSlaPolicies();
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-[var(--foreground)]">SLA policies</h1>
        <p className="mt-2 text-[13px] text-[var(--color-neutral-600)] max-w-2xl">
          Define first-response and resolution targets per priority. One policy is the
          tenant default; organizations may override with their own via
          Organizations → SLA policy.
        </p>
      </div>
      <SlaPoliciesEditor
        initialRows={rows.map((r) => ({
          id: r.id,
          name: r.name,
          description: r.description,
          targets: r.targets,
          isDefault: r.isDefault,
          active: r.active,
        }))}
      />
    </div>
  );
}
