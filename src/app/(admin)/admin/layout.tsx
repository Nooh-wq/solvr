import { redirect } from "next/navigation";
import { getSessionUser, roleAtLeast } from "@/lib/auth";
import { getTenantById } from "@/lib/tenant";
import { Sidebar, type NavLink } from "@/components/sidebar";
import { ImpersonationBanner } from "./impersonation-banner";

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

  const links: NavLink[] = [
    { href: "/admin", label: "Overview", icon: "overview" },
    { href: "/admin/team", label: "Team", icon: "team" },
    { href: "/admin/categories", label: "Categories", icon: "categories" },
    { href: "/admin/branding", label: "Branding", icon: "branding" },
    { href: "/admin/kb", label: "Knowledge base", icon: "kb" },
    { href: "/admin/audit-log", label: "Audit log", icon: "audit" },
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
      profileHref="/admin/profile"
      banner={user.isImpersonating ? <ImpersonationBanner tenantName={tenant.name} /> : undefined}
    >
      <main className="mx-auto max-w-screen-2xl px-6 py-8">{children}</main>
    </Sidebar>
  );
}
