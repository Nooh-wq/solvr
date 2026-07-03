import { redirect } from "next/navigation";
import { getSessionUser, roleAtLeast } from "@/lib/auth";
import { getCurrentTenant } from "@/lib/current-tenant";
import { Sidebar, type NavLink } from "@/components/sidebar";

export default async function AgentLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  if (!user) redirect("/auth/login");
  if (!roleAtLeast(user.role, "AGENT")) redirect("/portal");

  const tenant = await getCurrentTenant();
  if (tenant.id !== user.tenantId) redirect("/auth/login");

  const links: NavLink[] = [
    { href: "/agent", label: "Queue", icon: "tickets" },
    ...(roleAtLeast(user.role, "ADMIN") ? [{ href: "/admin", label: "Admin", icon: "overview" as const }] : []),
  ];

  return (
    <Sidebar
      productName={tenant.branding?.productName ?? "solvr"}
      logoUrl={tenant.branding?.logoUrl ?? null}
      links={links}
      userName={user.name}
      avatarUrl={user.avatarUrl}
      profileHref="/agent/profile"
    >
      <main className="mx-auto max-w-screen-2xl px-6 py-8">{children}</main>
    </Sidebar>
  );
}
