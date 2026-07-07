import { listTeam } from "@/actions/admin";
import { TeamDirectory } from "./team-directory";

export default async function TeamPage() {
  const team = await listTeam();
  // UNVERIFIED (hasn't confirmed their email OTP yet — see
  // verifyRegistrationOtp()) is genuinely transient; showing it in the
  // directory would just clutter with rows admins can't act on. Every
  // other status (including PENDING) is now merged into the main table
  // and sorted to the top for approval attention (spec §5.4).
  const visibleTeam = team.filter((u) => u.status !== "UNVERIFIED");

  // Last-Super-Admin lockout guard (spec §1.1): compute the count of ACTIVE
  // Super Admins so the table can disable role-change/deactivate/delete on
  // that one specific row. The server-side action re-checks this too — the
  // flag here is just to render the right buttons.
  const activeSuperAdminCount = team.filter((u) => u.role === "SUPER_ADMIN" && u.status === "ACTIVE").length;

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Team &amp; roles</h1>
      <TeamDirectory
        users={visibleTeam.map((u) => ({
          id: u.id,
          // Wrapper EndUser/TeamMember.name is nullable — fall back to
          // email so the directory row always renders a stable label.
          // Z1.5b: was legacy users.name (NOT NULL).
          name: u.name ?? u.email,
          email: u.email,
          role: u.role,
          status: u.status,
          // Prefer the linked Company's canonical name; fall back to the
          // legacy free-text company field for rows not yet backfilled.
          company: u.companyRef?.name ?? u.company,
          lastActiveAt: u.lastActiveAt ? u.lastActiveAt.toISOString() : null,
          isLastSuperAdmin: u.role === "SUPER_ADMIN" && u.status === "ACTIVE" && activeSuperAdminCount <= 1,
        }))}
      />
    </div>
  );
}
