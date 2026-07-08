import { listTeam } from "@/actions/admin";
import { TeamDirectory } from "../team/team-directory";

// Z3.2 — Team Members surface. Reuses the existing TeamDirectory (from
// the now-retired /admin/team route) but filtered to non-CLIENT rows.
// Customers moved to /admin/customers.

export default async function TeamMembersPage() {
  const team = await listTeam();
  const visible = team.filter((u) => u.status !== "UNVERIFIED" && u.role !== "CLIENT");
  const activeSuperAdminCount = team.filter(
    (u) => u.role === "SUPER_ADMIN" && u.status === "ACTIVE"
  ).length;

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Team members</h1>
      <TeamDirectory
        users={visible.map((u) => ({
          id: u.id,
          name: u.name ?? u.email,
          email: u.email,
          role: u.role,
          status: u.status,
          company: u.companyRef?.name ?? u.company,
          lastActiveAt: u.lastActiveAt ? u.lastActiveAt.toISOString() : null,
          isLastSuperAdmin:
            u.role === "SUPER_ADMIN" && u.status === "ACTIVE" && activeSuperAdminCount <= 1,
        }))}
      />
    </div>
  );
}
