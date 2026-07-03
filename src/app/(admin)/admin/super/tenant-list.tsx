"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { setTenantStatus, startImpersonation } from "@/actions/super";
import { Select } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";

type Tenant = {
  id: string;
  name: string;
  slug: string;
  type: string;
  status: string;
  userCount: number;
  ticketCount: number;
  createdAt: string;
};

export function TenantList({ tenants }: { tenants: Tenant[] }) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();

  function changeStatus(id: string, name: string, status: string) {
    startTransition(async () => {
      try {
        await setTenantStatus(id, status as "ACTIVE" | "SUSPENDED" | "TRIAL");
        toast({ title: "Tenant status updated", description: `${name} → ${status}`, variant: "success" });
        router.refresh();
      } catch (e) {
        toast({ title: "Couldn't update tenant status", description: e instanceof Error ? e.message : undefined, variant: "error" });
      }
    });
  }

  function impersonate(id: string) {
    startTransition(async () => {
      try {
        await startImpersonation(id);
      } catch (e) {
        toast({ title: "Couldn't start impersonation", description: e instanceof Error ? e.message : undefined, variant: "error" });
      }
    });
  }

  return (
    <div className="bg-white border border-[var(--color-neutral-300)] rounded overflow-hidden">
      <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-[var(--color-light-gray)] text-[11px] uppercase-label text-[var(--color-neutral-700)]">
          <tr>
            <th className="text-left font-semibold px-4 py-2.5">Tenant</th>
            <th className="text-left font-semibold px-4 py-2.5">Type</th>
            <th className="text-left font-semibold px-4 py-2.5">Status</th>
            <th className="text-left font-semibold px-4 py-2.5">Users</th>
            <th className="text-left font-semibold px-4 py-2.5">Tickets</th>
            <th className="text-left font-semibold px-4 py-2.5"></th>
          </tr>
        </thead>
        <tbody>
          {tenants.map((t) => (
            <tr key={t.id} className="border-t border-[var(--color-neutral-100)]">
              <td className="px-4 py-3">
                <span className="font-medium">{t.name}</span>
                <span className="text-[var(--color-neutral-600)] font-mono text-[11px] ml-2">{t.slug}</span>
              </td>
              <td className="px-4 py-3 text-[var(--color-neutral-600)]">{t.type}</td>
              <td className="px-4 py-3">
                {t.type === "INTERNAL" ? (
                  <span className="text-[13px]">{t.status}</span>
                ) : (
                  <Select
                    value={t.status}
                    disabled={pending}
                    onChange={(e) => changeStatus(t.id, t.name, e.target.value)}
                    className="h-8 text-[13px] w-28"
                  >
                    <option value="ACTIVE">Active</option>
                    <option value="TRIAL">Trial</option>
                    <option value="SUSPENDED">Suspended</option>
                  </Select>
                )}
              </td>
              <td className="px-4 py-3 font-mono">{t.userCount}</td>
              <td className="px-4 py-3 font-mono">{t.ticketCount}</td>
              <td className="px-4 py-3">
                {t.type === "CLIENT" && (
                  <Button variant="secondary" size="sm" disabled={pending} onClick={() => impersonate(t.id)}>
                    Impersonate
                  </Button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </div>
  );
}
