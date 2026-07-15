import { redirect } from "next/navigation";
import { getSessionUser, roleAtLeast } from "@/lib/auth";
import { getTenantById } from "@/lib/tenant";
import { Sidebar } from "@/components/sidebar";
import { ImpersonationBanner } from "./impersonation-banner";
import { listPendingUsers } from "@/actions/admin";
import { listPendingAccountDeletions } from "@/actions/accountDeletions";
import { buildAdminNav } from "@/lib/admin-nav";
import { CommandPalette } from "@/components/command-palette";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  if (!user) redirect("/auth/login");
  if (!roleAtLeast(user.role, "ADMIN")) redirect("/agent");

  const tenant = await getTenantById(user.tenantId);
  if (!tenant) redirect("/auth/login");

  // Pending-approval + deletion counts for the sidebar badges. Best-effort:
  // if the queries fail (RLS, stale session, etc.) we just omit the badges
  // rather than breaking the whole admin layout.
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

  const nav = buildAdminNav({
    role: user.role,
    tenantType: tenant.type,
    pendingCount,
    deletionCount,
  });

  return (
    <Sidebar
      productName={`${tenant.branding?.productName ?? "solvr"} · Admin`}
      logoUrl={tenant.branding?.logoUrl ?? null}
      links={nav.top}
      sections={nav.sections}
      footer={nav.footer}
      showAdminSearch
      userName={user.name}
      avatarUrl={user.avatarUrl}
      profileHref="/admin/account"
      banner={user.isImpersonating ? <ImpersonationBanner tenantName={tenant.name} /> : undefined}
    >
      <main className="mx-auto max-w-screen-2xl px-6 py-8">{children}</main>
      <CommandPalette />
    </Sidebar>
  );
}
