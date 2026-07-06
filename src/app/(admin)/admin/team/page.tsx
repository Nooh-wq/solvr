import { listTeam, listPendingUsers } from "@/actions/admin";
import { TeamDirectory } from "./team-directory";
import { PendingApprovals } from "./pending-approvals";

export default async function TeamPage() {
  const [team, pending] = await Promise.all([listTeam(), listPendingUsers()]);
  // UNVERIFIED (hasn't confirmed their email yet — see verifyRegistrationOtp())
  // is just as transient/not-yet-actionable as PENDING, so it's excluded from
  // the main directory the same way.
  const activeTeam = team.filter((u) => u.status !== "PENDING" && u.status !== "UNVERIFIED");

  // Last-Super-Admin lockout guard (spec §1.1): compute the count of ACTIVE
  // Super Admins so the table can disable role-change/deactivate/delete on
  // that one specific row. The server-side action re-checks this too — the
  // flag here is just to render the right buttons.
  const activeSuperAdminCount = team.filter((u) => u.role === "SUPER_ADMIN" && u.status === "ACTIVE").length;

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
        users={activeTeam.map((u) => ({
          id: u.id,
          name: u.name,
          email: u.email,
          role: u.role,
          status: u.status,
          isLastSuperAdmin: u.role === "SUPER_ADMIN" && u.status === "ACTIVE" && activeSuperAdminCount <= 1,
        }))}
      />
    </div>
  );
}
