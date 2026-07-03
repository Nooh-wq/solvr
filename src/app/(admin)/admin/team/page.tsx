import { listTeam, listPendingUsers } from "@/actions/admin";
import { InviteUserForm } from "./invite-user-form";
import { TeamTable } from "./team-table";
import { PendingApprovals } from "./pending-approvals";

export default async function TeamPage() {
  const [team, pending] = await Promise.all([listTeam(), listPendingUsers()]);
  const activeTeam = team.filter((u) => u.status !== "PENDING");

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Team & roles</h1>
      {pending.length > 0 && (
        <div className="mb-6">
          <PendingApprovals
            users={pending.map((u) => ({ id: u.id, name: u.name, email: u.email, company: u.company, createdAt: u.createdAt.toISOString() }))}
          />
        </div>
      )}
      <div className="grid grid-cols-3 gap-6">
        <div className="col-span-2">
          <TeamTable
            users={activeTeam.map((u) => ({ id: u.id, name: u.name, email: u.email, role: u.role, status: u.status }))}
          />
        </div>
        <div>
          <InviteUserForm />
        </div>
      </div>
    </div>
  );
}
