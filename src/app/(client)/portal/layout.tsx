import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { getCurrentTenant } from "@/lib/current-tenant";
import { Sidebar } from "@/components/sidebar";
import { ChatWidget } from "@/components/chat-widget";

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  if (!user) redirect("/auth/login");

  const tenant = await getCurrentTenant();
  if (tenant.id !== user.tenantId) redirect("/auth/login");

  return (
    <Sidebar
      productName={tenant.branding?.productName ?? "solvr"}
      logoUrl={tenant.branding?.logoUrl ?? null}
      links={[
        { href: "/portal", label: "Tickets", icon: "tickets" },
        { href: "/portal/new", label: "New ticket", icon: "newTicket" },
      ]}
      userName={user.name}
      avatarUrl={user.avatarUrl}
      profileHref="/portal/profile"
    >
      <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
      <ChatWidget />
    </Sidebar>
  );
}
