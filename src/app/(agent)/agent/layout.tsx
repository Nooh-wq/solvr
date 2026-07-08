import { redirect } from "next/navigation";
import { getSessionUser, roleAtLeast } from "@/lib/auth";
import { getCurrentTenant } from "@/lib/current-tenant";
import { Sidebar, type NavLink } from "@/components/sidebar";
import { buildAdminNav } from "@/lib/admin-nav";
import { listPendingUsers } from "@/actions/admin";
import { listPendingAccountDeletions } from "@/actions/accountDeletions";

export default async function AgentLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  if (!user) redirect("/auth/login");
  if (!roleAtLeast(user.role, "AGENT")) redirect("/portal");

  const tenant = await getCurrentTenant();
  if (tenant.id !== user.tenantId) redirect("/auth/login");

  // Admin+ users see the same nav here as on /admin, so clicking Queue
  // from the admin sidebar doesn't collapse the workspace to a
  // Queue+Admin stub. Agents (no admin surface) get the minimal nav.
  let topLinks: NavLink[];
  let sections: ReturnType<typeof buildAdminNav>["sections"] | undefined;
  let footer: NavLink[] | undefined;
  let showAdminSearch = false;
  if (roleAtLeast(user.role, "ADMIN")) {
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
      // Non-fatal — badges just don't render.
    }
    const nav = buildAdminNav({
      role: user.role,
      tenantType: tenant.type,
      pendingCount,
      deletionCount,
    });
    topLinks = nav.top;
    sections = nav.sections;
    footer = nav.footer;
    showAdminSearch = true;
  } else {
    topLinks = [{ href: "/agent", label: "Queue", icon: "tickets" }];
  }

  return (
    <Sidebar
      productName={tenant.branding?.productName ?? "solvr"}
      logoUrl={tenant.branding?.logoUrl ?? null}
      links={topLinks}
      sections={sections}
      footer={footer}
      showAdminSearch={showAdminSearch}
      userName={user.name}
      avatarUrl={user.avatarUrl}
      profileHref="/agent/account"
    >
      <main className="mx-auto max-w-screen-2xl px-6 py-8">{children}</main>
    </Sidebar>
  );
}
