import Link from "next/link";
import { listTenantsWithHealth } from "@/actions/super";
import { TenantList } from "./tenant-list";
import { CreateTenantForm } from "./create-tenant-form";

export default async function SuperAdminPage() {
  const tenants = await listTenantsWithHealth();

  return (
    <div>
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold mb-1">Super admin</h1>
          <p className="text-sm text-[var(--color-neutral-600)]">
            Provision and manage white-label tenants. Host-tenant operators only.
          </p>
        </div>
        <Link
          href="/admin/super/analytics"
          className="text-[13px] font-medium text-[var(--color-primary)] hover:underline"
        >
          Cross-tenant health →
        </Link>
      </div>
      <div className="grid grid-cols-3 gap-6">
        <div className="col-span-2">
          <TenantList
            tenants={tenants.map((t) => ({
              id: t.id,
              name: t.name,
              slug: t.slug,
              type: t.type,
              status: t.status,
              userCount: t.userCount,
              ticketCount: t.ticketCount,
              createdAt: t.createdAt.toISOString(),
            }))}
          />
        </div>
        <div>
          <CreateTenantForm />
        </div>
      </div>
    </div>
  );
}
