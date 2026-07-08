"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { changeTeamMemberScope } from "@/actions/admin";
import { Select } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";

// Z5.2 — surfaces the acting agent's ticket access scope so an admin can
// restrict who sees what. The three-value shape matches the wrapper's
// TicketAccessScope enum. ORG is spec'd as a fourth value (Z5.1); that
// lands once the shared platform adds it to the enum — see
// docs/z5-wrapper-deps.md.

type Scope = "ALL" | "GROUPS" | "ASSIGNED_ONLY";

const OPTIONS: { value: Scope; label: string; hint: string }[] = [
  { value: "ALL", label: "All tickets", hint: "Every ticket in the tenant." },
  { value: "GROUPS", label: "Their groups", hint: "Tickets assigned to any teammate in one of their groups, plus unassigned." },
  { value: "ASSIGNED_ONLY", label: "Assigned only", hint: "Only tickets assigned to this agent." },
];

export function ScopeEditor({
  teamMemberId,
  initialScope,
  disabled,
}: {
  teamMemberId: string;
  initialScope: Scope;
  disabled?: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [scope, setScope] = useState<Scope>(initialScope);
  const [pending, startTransition] = useTransition();

  function onChange(next: Scope) {
    if (next === scope || pending) return;
    const prev = scope;
    setScope(next);
    startTransition(async () => {
      try {
        await changeTeamMemberScope({ teamMemberId, scope: next });
        toast({ title: "Ticket access scope updated", variant: "success" });
        router.refresh();
      } catch (e) {
        setScope(prev);
        toast({
          title: "Couldn't update scope",
          description: e instanceof Error ? e.message : undefined,
          variant: "error",
        });
      }
    });
  }

  const hint = OPTIONS.find((o) => o.value === scope)?.hint ?? "";

  return (
    <div className="bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl p-5">
      <h3 className="text-sm font-semibold mb-1">Ticket access scope</h3>
      <p className="text-[12px] text-[var(--color-neutral-500)] mb-3">
        Controls which tickets this team member can see. Enforced across the
        queue, ticket search, and direct URL loads.
      </p>
      <Select
        value={scope}
        onChange={(e) => onChange(e.target.value as Scope)}
        disabled={disabled || pending}
      >
        {OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </Select>
      <p className="text-[11px] text-[var(--color-neutral-500)] mt-2">{hint}</p>
    </div>
  );
}
