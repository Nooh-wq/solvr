import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { getCurrentTenant } from "@/lib/current-tenant";

export default async function SuperAdminLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  if (!user) redirect("/auth/login");
  if (user.role !== "SUPER_ADMIN") redirect("/admin");

  const tenant = await getCurrentTenant();
  if (tenant.type !== "INTERNAL") redirect("/admin");

  return <>{children}</>;
}
