import { redirect } from "next/navigation";
import { getSessionUser, roleAtLeast } from "@/lib/auth";
import { getTenantById } from "@/lib/tenant";
import { Sidebar, type NavLink } from "@/components/sidebar";
import { ImpersonationBanner } from "./impersonation-banner";
import { listPendingUsers } from "@/actions/admin";
import { listPendingAccountDeletions } from "@/actions/accountDeletions";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  if (!user) redirect("/auth/login");
  if (!roleAtLeast(user.role, "ADMIN")) redirect("/agent");

  // Resolved by the session's tenantId, not the request host: when
  // impersonating, those differ on purpose (you stay on the host's own
  // domain and view a target tenant's admin panel via the impersonation
  // cookie — see src/lib/auth.ts's getSessionUser()).
  const tenant = await getTenantById(user.tenantId);
  if (!tenant) redirect("/auth/login");

  // Pending-approval count for the Team nav badge (spec §5.4). Best-effort:
  // if the query fails for any reason (RLS, stale session, etc.) we just
  // omit the badge rather than breaking the whole admin layout.
  let pendingCount = 0;
  let deletionCount = 0;
  try {
    const [pending, deletions] = await Promise.all([
      listPendingUsers(),
      listPendingAccountDeletions(),
    ]);
    pendingCount = pending.length;
    deletionCount = deletions.length;
  } catch {
    // Non-fatal.
  }

  const links: NavLink[] = [
    { href: "/admin", label: "Overview", icon: "overview" },
    { href: "/admin/analytics", label: "Analytics", icon: "analytics" },
    { href: "/admin/team", label: "Team", icon: "team", badge: pendingCount },
    { href: "/admin/categories", label: "Categories", icon: "categories" },
    { href: "/admin/fields", label: "Fields", icon: "fields" },
    { href: "/admin/forms", label: "Forms", icon: "forms" },
    { href: "/admin/branding", label: "Branding", icon: "branding" },
    { href: "/admin/kb", label: "Knowledge base", icon: "kb" },
    { href: "/admin/audit-log", label: "Audit log", icon: "audit" },
    { href: "/admin/account-deletions", label: "Deletion requests", icon: "audit", badge: deletionCount },
    { href: "/agent", label: "Queue", icon: "tickets" },
    ...(user.role === "SUPER_ADMIN" && tenant.type === "INTERNAL"
      ? [{ href: "/admin/super", label: "Super admin", icon: "super" as const }]
      : []),
  ];

  return (
    <Sidebar
      productName={`${tenant.branding?.productName ?? "solvr"} · Admin`}
      logoUrl={tenant.branding?.logoUrl ?? null}
      links={links}
      userName={user.name}
      avatarUrl={user.avatarUrl}
      profileHref="/admin/account"
      banner={user.isImpersonating ? <ImpersonationBanner tenantName={tenant.name} /> : undefined}
    >
      <main className="mx-auto max-w-screen-2xl px-6 py-8">{children}</main>
    </Sidebar>
  );
}
