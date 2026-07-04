"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { approveUser, rejectUser } from "@/actions/admin";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";

type PendingUser = { id: string; name: string; email: string; company: string | null; createdAt: string };

export function PendingApprovals({ users }: { users: PendingUser[] }) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();

  function approve(userId: string, name: string) {
    startTransition(async () => {
      try {
        await approveUser({ userId });
        toast({ title: "Registration approved", description: name, variant: "success" });
        router.refresh();
      } catch (e) {
        toast({ title: "Couldn't approve registration", description: e instanceof Error ? e.message : undefined, variant: "error" });
      }
    });
  }

  function reject(userId: string, name: string) {
    startTransition(async () => {
      try {
        await rejectUser({ userId });
        toast({ title: "Registration rejected", description: name, variant: "success" });
        router.refresh();
      } catch (e) {
        toast({ title: "Couldn't reject registration", description: e instanceof Error ? e.message : undefined, variant: "error" });
      }
    });
  }

  return (
    <div className="bg-white border border-[var(--color-neutral-300)] rounded-2xl overflow-hidden">
      <div className="px-4 py-2.5 bg-[var(--color-light-gray)] border-b border-[var(--color-neutral-300)]">
        <span className="text-[11px] uppercase-label font-semibold text-[var(--color-neutral-700)]">
          Pending approval ({users.length})
        </span>
      </div>
      <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <tbody>
          {users.map((u) => (
            <tr key={u.id} className="border-t border-[var(--color-neutral-100)]">
              <td className="px-4 py-3">
                <div className="font-medium">{u.name}</div>
                <div className="text-[var(--color-neutral-600)] text-[13px]">
                  {u.email}
                  {u.company ? ` · ${u.company}` : ""}
                </div>
              </td>
              <td className="px-4 py-3 text-right space-x-2 whitespace-nowrap">
                <Button variant="secondary" size="sm" disabled={pending} onClick={() => reject(u.id, u.name)}>
                  Reject
                </Button>
                <Button size="sm" disabled={pending} onClick={() => approve(u.id, u.name)}>
                  Approve
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </div>
  );
}
