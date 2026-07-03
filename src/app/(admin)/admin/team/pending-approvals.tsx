"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { approveUser, rejectUser } from "@/actions/admin";
import { Button } from "@/components/ui/button";

type PendingUser = { id: string; name: string; email: string; company: string | null; createdAt: string };

export function PendingApprovals({ users }: { users: PendingUser[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function approve(userId: string) {
    startTransition(async () => {
      await approveUser({ userId });
      router.refresh();
    });
  }

  function reject(userId: string) {
    startTransition(async () => {
      await rejectUser({ userId });
      router.refresh();
    });
  }

  return (
    <div className="bg-white border border-[var(--color-neutral-300)] rounded overflow-hidden">
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
                <Button variant="secondary" size="sm" disabled={pending} onClick={() => reject(u.id)}>
                  Reject
                </Button>
                <Button size="sm" disabled={pending} onClick={() => approve(u.id)}>
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
