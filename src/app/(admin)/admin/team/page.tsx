import { listTeam, listPendingUsers } from "@/actions/admin";
import { TeamDirectory } from "./team-directory";
import { PendingApprovals } from "./pending-approvals";

export default async function TeamPage() {
  const [team, pending] = await Promise.all([listTeam(), listPendingUsers()]);
  const activeTeam = team.filter((u) => u.status !== "PENDING");

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Team &amp; roles</h1>
      {pending.length > 0 && (
        <div className="mb-6">
          <PendingApprovals
            users={pending.map((u) => ({ id: u.id, name: u.name, email: u.email, company: u.company, createdAt: u.createdAt.toISOString() }))}
          />
        </div>
      )}
      <TeamDirectory
        users={activeTeam.map((u) => ({ id: u.id, name: u.name, email: u.email, role: u.role, status: u.status }))}
      />
    </div>
  );
}
