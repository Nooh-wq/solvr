import { listOrganizationsWithStats } from "@/actions/organizations";
import { OrganizationsDirectory } from "./organizations-directory";

// Z4.1 — Organizations list. Server component hydrates a wide page in
// one round-trip; directory does client-side filter/sort/paginate.

export default async function OrganizationsPage() {
  const orgs = await listOrganizationsWithStats();
  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Organizations</h1>
      <OrganizationsDirectory
        organizations={orgs.map((o) => ({
          ...o,
          createdAt: o.createdAt.toISOString(),
        }))}
      />
    </div>
  );
}
