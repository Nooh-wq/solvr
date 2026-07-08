"use client";

// Z4.3 — Group members panel. Add via dropdown, remove via row action
// (server-side action enforces the "≥1 group per team member" invariant
// so the UI can call it optimistically without an extra client-side
// count check).

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/toast";
import { addMemberToGroup, removeMemberFromGroup } from "@/actions/groups";
import { Select } from "@/components/ui/input";
import type { TicketAccessScope } from "@/lib/shared-platform";

type Member = {
  id: string;
  name: string | null;
  email: string;
  ticketAccessScope: TicketAccessScope;
  openTicketCount: number;
};

const SCOPE_LABEL: Record<TicketAccessScope, string> = {
  ALL: "All tickets",
  GROUPS: "Their groups",
  ASSIGNED_ONLY: "Assigned only",
};

export function GroupMembersPanel({
  groupId,
  groupName,
  members,
  assignable,
}: {
  groupId: string;
  groupName: string;
  members: Member[];
  assignable: Array<{ id: string; name: string | null; email: string }>;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [selection, setSelection] = useState<string>("");
  const [pending, startTransition] = useTransition();

  function handleAdd() {
    if (selection === "") return;
    const teamMemberId = selection;
    startTransition(async () => {
      const res = await addMemberToGroup({ groupId, teamMemberId });
      if ("ok" in res && res.ok) {
        setSelection("");
        router.refresh();
      } else {
        toast({
          title: "Couldn't add",
          description: "error" in res ? res.error : undefined,
          variant: "error",
        });
      }
    });
  }

  function handleRemove(teamMemberId: string, name: string) {
    startTransition(async () => {
      const res = await removeMemberFromGroup({ groupId, teamMemberId });
      if ("ok" in res && res.ok) {
        router.refresh();
      } else {
        toast({
          title: `Couldn't remove ${name}`,
          description: "error" in res ? res.error : undefined,
          variant: "error",
        });
      }
    });
  }

  return (
    <div className="bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl p-5">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-[13px] font-semibold">Members</h2>
        <div className="flex items-center gap-2">
          <Select
            value={selection}
            onChange={(e) => setSelection(e.target.value)}
            className="h-8 w-56 text-[12px]"
            disabled={assignable.length === 0}
          >
            <option value="">
              {assignable.length === 0 ? "Everyone is already in this group" : "Add a team member…"}
            </option>
            {assignable.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name ?? m.email}
              </option>
            ))}
          </Select>
          <button
            type="button"
            onClick={handleAdd}
            disabled={selection === "" || pending}
            className="h-8 px-3 text-[12px] font-medium bg-[var(--color-primary)] text-white rounded-lg cursor-pointer hover:opacity-90 disabled:opacity-50"
          >
            Add
          </button>
        </div>
      </div>

      {members.length === 0 ? (
        <div className="text-[13px] text-[var(--color-neutral-500)] py-4">
          {groupName} has no members yet. Add someone above.
        </div>
      ) : (
        <ul className="divide-y divide-[var(--color-neutral-200)] dark:divide-white/5 -mx-2">
          {members.map((m) => (
            <li key={m.id} className="px-2 py-2.5 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-medium truncate">{m.name ?? m.email}</div>
                <div className="text-[11px] text-[var(--color-neutral-500)] flex items-center gap-2">
                  <span className="truncate">{m.email}</span>
                  <span>·</span>
                  <span>Scope: {SCOPE_LABEL[m.ticketAccessScope]}</span>
                </div>
              </div>
              <div className="text-[12px] text-[var(--color-neutral-500)] tabular-nums">
                {m.openTicketCount} open
              </div>
              <button
                type="button"
                onClick={() => handleRemove(m.id, m.name ?? m.email)}
                disabled={pending}
                className="text-[12px] text-red-600 dark:text-red-400 hover:underline cursor-pointer disabled:opacity-50"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
