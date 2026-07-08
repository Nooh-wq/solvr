import { listRolesForAdmin } from "@/actions/roles";
import { RolesDirectory } from "./roles-directory";

// Z5.4 — Roles surface. Shipping a minimal editor: standard roles are
// read-only (isCustom:false, wrapper-enforced); custom roles can be
// created, renamed, and have permissions toggled across the 8
// categories from src/lib/permissions.ts.

export default async function RolesPage() {
  const roles = await listRolesForAdmin();
  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Roles</h1>
      <RolesDirectory
        initialRoles={roles.map((r) => ({
          id: r.id,
          name: r.name,
          isCustom: r.isCustom,
          permissions: r.permissions as Record<string, boolean>,
        }))}
      />
    </div>
  );
}
