import { listCatalogItems } from "@/actions/serviceCatalog";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { listTeamMembers } from "@/lib/shared-platform/team-members";
import { systemContext } from "@/lib/shared-platform";
import { CatalogEditor } from "./catalog-editor";

export default async function ServiceCatalogPage() {
  const session = await requireSession({ minRole: "ADMIN" });
  const [items, defs, groups, tmPage] = await Promise.all([
    listCatalogItems(),
    prisma.customFieldDefinition.findMany({
      where: { tenantId: session.tenantId, isActive: true, scope: { in: ["TICKET", "USER"] } },
      orderBy: [{ scope: "asc" }, { position: "asc" }, { label: "asc" }],
      select: { id: true, label: true, scope: true, type: true },
    }),
    prisma.group.findMany({
      where: { tenantId: session.tenantId },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    listTeamMembers(systemContext(session.tenantId), { limit: 200 }),
  ]);
  const teamMembers = tmPage.items.map((m) => ({
    id: m.id,
    name: m.name ?? m.email ?? m.id,
  }));

  return (
    <div>
      <h1 className="text-2xl font-bold mb-1">Service catalog</h1>
      <p className="text-sm text-[var(--color-neutral-600)] mb-6">
        Predefined request types like &ldquo;New laptop&rdquo; or &ldquo;Access request&rdquo;. Employees
        submit them from the portal; each item can attach a dynamic form (reuses your custom fields) and
        require multi-step approval.
      </p>
      <CatalogEditor
        items={items}
        customFields={defs.map((d) => ({
          id: d.id,
          label: d.label,
          scope: d.scope,
          type: d.type,
        }))}
        groups={groups}
        teamMembers={teamMembers}
      />
    </div>
  );
}
