import Link from "next/link";
import { notFound } from "next/navigation";
import { loadUserProfile } from "@/actions/userProfile";
import { listValuesForTarget } from "@/actions/customFields";
import { listRolesForAdmin } from "@/actions/roles";
import { CustomFieldsEditor } from "@/components/custom-fields-editor";
import { NotesEditor } from "./notes-editor";
import { InteractionsTimeline } from "./interactions-timeline";
import { ScopeEditor } from "./scope-editor";
import { RoleEditor } from "./role-editor";
import { requireSession } from "@/lib/auth";

// Z3.3 — Deep user profile. Works for either an EndUser or a
// TeamMember (subjectId space is shared post-Z1.3). Server component:
// hydrates one round-trip's worth of data and hands off to a small
// client note editor + client interactions timeline.

export default async function UserProfilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [session, profile] = await Promise.all([
    requireSession({ minRole: "ADMIN" }),
    loadUserProfile(id),
  ]);
  if (!profile) notFound();
  const { header, tickets, chats, kbViews } = profile;
  const isSelf = header.id === session.subjectId;

  // Roles list is only needed for the team-member role picker. Skip the
  // extra wrapper call for end users — nothing on their profile consumes it.
  const roles =
    header.kind === "TEAM_MEMBER" && header.roleId
      ? await listRolesForAdmin()
      : [];

  // Only end users have USER-scoped custom fields today. The values list
  // is filtered inside the CFV action to hide inactive-with-no-value rows.
  const customFields =
    header.kind === "END_USER" ? await listValuesForTarget("USER", header.id) : [];

  const initials =
    (header.name ?? header.email)
      .split(/\s+/)
      .slice(0, 2)
      .map((s) => s[0]?.toUpperCase() ?? "")
      .join("") || "?";

  return (
    <div>
      <div className="mb-4 text-[12px] text-[var(--color-neutral-500)]">
        <Link
          href={header.kind === "END_USER" ? "/admin/customers" : "/admin/team-members"}
          className="hover:text-[var(--foreground)]"
        >
          ← Back to {header.kind === "END_USER" ? "customers" : "team members"}
        </Link>
      </div>

      {/* Header card */}
      <div className="bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl p-6 mb-6">
        <div className="flex items-start gap-5">
          {header.avatarUrl ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={header.avatarUrl}
              alt={header.name ?? header.email}
              className="h-20 w-20 rounded-full object-cover"
            />
          ) : (
            <div className="h-20 w-20 rounded-full bg-[var(--color-primary)]/10 text-[var(--color-primary)] text-2xl font-semibold flex items-center justify-center">
              {initials}
            </div>
          )}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 mb-1">
              <h1 className="text-2xl font-bold truncate">
                {header.name ?? header.email}
              </h1>
              <span
                className={`text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded font-semibold ${roleBadgeClass(
                  header.role
                )}`}
              >
                {roleLabel(header.role)}
              </span>
              <span
                className={`text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded font-semibold ${statusBadgeClass(
                  header.status
                )}`}
              >
                {statusLabel(header.status)}
              </span>
            </div>
            <div className="text-[13px] text-[var(--color-neutral-600)]">
              {header.email}
            </div>
            {header.organizations.length > 0 && (
              <div className="text-[12px] text-[var(--color-neutral-500)] mt-1">
                {header.organizations.map((o, i) => (
                  <span key={o.id}>
                    {i > 0 && " · "}
                    {o.name}
                    {i === 0 && header.organizations.length > 1 && " (primary)"}
                  </span>
                ))}
              </div>
            )}
            {header.tags.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-2">
                {header.tags.map((t) => (
                  <span
                    key={t.id}
                    className="px-1.5 py-0.5 rounded text-[10px] font-medium"
                    style={{ backgroundColor: `${t.color}22`, color: t.color }}
                  >
                    {t.name}
                  </span>
                ))}
              </div>
            )}
          </div>
          <div className="text-right text-[12px] text-[var(--color-neutral-500)]">
            <div>
              <span className="text-[var(--color-neutral-600)] font-medium">
                {tickets.length}
              </span>{" "}
              tickets
            </div>
            {header.csatAvg !== null && (
              <div>
                <span className="text-[var(--color-neutral-600)] font-medium">
                  {header.csatAvg.toFixed(1)}
                </span>{" "}
                CSAT ({header.csatCount})
              </div>
            )}
            {header.lastActiveAt && (
              <div className="mt-1">
                Last active {formatRelative(header.lastActiveAt.toISOString())}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <InteractionsTimeline tickets={tickets} chats={chats} kbViews={kbViews} />
        </div>
        <div className="space-y-6">
          <NotesEditor userId={header.id} initialNotes={header.notes ?? ""} />
          {header.kind === "TEAM_MEMBER" && header.roleId && header.roleName && (
            <RoleEditor
              teamMemberId={header.id}
              initialRoleId={header.roleId}
              initialRoleName={header.roleName}
              roles={roles.map((r) => ({ id: r.id, name: r.name, isCustom: r.isCustom }))}
              disabled={isSelf}
              canPromoteToSuperAdmin={session.role === "SUPER_ADMIN" && !isSelf}
            />
          )}
          {header.kind === "TEAM_MEMBER" && header.ticketAccessScope && (
            <ScopeEditor
              teamMemberId={header.id}
              initialScope={header.ticketAccessScope}
              disabled={isSelf}
            />
          )}
          {customFields.length > 0 && (
            <CustomFieldsEditor
              title="Custom fields"
              rows={customFields}
              targetId={header.id}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function roleLabel(r: string): string {
  switch (r) {
    case "SUPER_ADMIN":
      return "Super Admin";
    case "ADMIN":
      return "Admin";
    case "AGENT":
      return "Agent";
    default:
      return "Client";
  }
}

function roleBadgeClass(r: string): string {
  switch (r) {
    case "SUPER_ADMIN":
      return "bg-purple-500/15 text-purple-700 dark:text-purple-300";
    case "ADMIN":
      return "bg-blue-500/15 text-blue-700 dark:text-blue-300";
    case "AGENT":
      return "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300";
    default:
      return "bg-[var(--color-neutral-200)] text-[var(--color-neutral-700)]";
  }
}

function statusLabel(s: string): string {
  return s.charAt(0) + s.slice(1).toLowerCase();
}

function statusBadgeClass(s: string): string {
  switch (s) {
    case "ACTIVE":
      return "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300";
    case "INVITED":
      return "bg-amber-500/15 text-amber-700 dark:text-amber-300";
    case "PENDING":
      return "bg-amber-500/15 text-amber-700 dark:text-amber-300";
    case "SUSPENDED":
      return "bg-red-500/15 text-red-700 dark:text-red-300";
    default:
      return "bg-[var(--color-neutral-200)] text-[var(--color-neutral-700)]";
  }
}

function formatRelative(iso: string | null): string {
  if (!iso) return "—";
  const t = new Date(iso).getTime();
  const delta = Date.now() - t;
  const day = 86_400_000;
  if (delta < day) return "today";
  if (delta < day * 2) return "yesterday";
  if (delta < day * 30) return `${Math.floor(delta / day)}d ago`;
  return `${Math.floor(delta / (day * 30))}mo ago`;
}
