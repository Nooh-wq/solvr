import { listMacros } from "@/actions/macros";
import { requireSession } from "@/lib/auth";
import { roleAtLeast } from "@/lib/auth";
import { MacrosEditor } from "./editor";

export default async function MacrosPage() {
  const [session, macros] = await Promise.all([
    requireSession({ minRole: "AGENT" }),
    listMacros(),
  ]);
  const canShare = roleAtLeast(session.role, "ADMIN");
  return (
    <div>
      <h1 className="text-2xl font-bold mb-2">Macros</h1>
      <p className="text-[13px] text-[var(--color-neutral-500)] mb-6">
        Bundles of actions an agent can apply to a ticket with one click.
        Every action re-checks your permissions when the macro fires — a
        Light Agent macro cannot post a public message even if the action
        is defined.
      </p>
      <MacrosEditor
        initialRows={macros.map((m) => ({
          id: m.id,
          name: m.name,
          description: m.description,
          actions: m.actions,
          isShared: m.isShared,
          isOwned: m.isOwned,
        }))}
        canShare={canShare}
      />
    </div>
  );
}
