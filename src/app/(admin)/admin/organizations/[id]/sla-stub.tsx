"use client";

// M2.6 — org SLA + business-hours overrides. Previously a stub (Z4.5)
// while the SLA engine wasn't built. Now functional: the dropdowns
// list the tenant's policies/calendars; "Use tenant default" clears
// the override.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Select } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { updateOrganizationOverrides } from "@/actions/organizations";

type PolicyOption = { id: string; name: string; isDefault: boolean };
type CalendarOption = { id: string; name: string; timezone: string; isDefault: boolean };

export function SlaBusinessHoursStub({
  organizationId,
  slaPolicyId,
  businessHoursId,
  policies,
  calendars,
}: {
  organizationId: string;
  slaPolicyId: string | null;
  businessHoursId: string | null;
  policies: PolicyOption[];
  calendars: CalendarOption[];
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [sla, setSla] = useState(slaPolicyId ?? "");
  const [cal, setCal] = useState(businessHoursId ?? "");

  function save(next: { sla?: string; cal?: string }) {
    const nextSla = next.sla !== undefined ? next.sla : sla;
    const nextCal = next.cal !== undefined ? next.cal : cal;
    setSla(nextSla);
    setCal(nextCal);
    startTransition(async () => {
      try {
        await updateOrganizationOverrides({
          organizationId,
          slaPolicyId: nextSla === "" ? null : nextSla,
          businessHoursId: nextCal === "" ? null : nextCal,
        });
        toast({ title: "Overrides saved", variant: "success" });
        router.refresh();
      } catch (e) {
        toast({
          title: "Couldn't save",
          description: e instanceof Error ? e.message : undefined,
          variant: "error",
        });
      }
    });
  }

  return (
    <div className="bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl p-5 space-y-4">
      <h2 className="text-[13px] font-semibold">SLA & business hours</h2>
      <div>
        <label className="text-[11px] font-semibold text-[var(--color-neutral-600)] uppercase tracking-wide">
          Assigned SLA policy
        </label>
        <Select
          className="mt-1 h-9"
          disabled={pending}
          value={sla}
          onChange={(e) => save({ sla: e.target.value })}
        >
          <option value="">
            Use tenant default{policies.find((p) => p.isDefault) ? ` (${policies.find((p) => p.isDefault)!.name})` : ""}
          </option>
          {policies.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
              {p.isDefault ? " · default" : ""}
            </option>
          ))}
        </Select>
      </div>
      <div>
        <label className="text-[11px] font-semibold text-[var(--color-neutral-600)] uppercase tracking-wide">
          Business-hours override
        </label>
        <Select
          className="mt-1 h-9"
          disabled={pending}
          value={cal}
          onChange={(e) => save({ cal: e.target.value })}
        >
          <option value="">
            Use tenant default{calendars.find((c) => c.isDefault) ? ` (${calendars.find((c) => c.isDefault)!.name})` : ""}
          </option>
          {calendars.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} · {c.timezone}
              {c.isDefault ? " · default" : ""}
            </option>
          ))}
        </Select>
      </div>
      {policies.length === 0 && (
        <p className="text-[11px] text-[var(--color-neutral-500)] pt-1">
          Create at least one SLA policy under Objects & Rules → SLA policies before an
          override can take effect.
        </p>
      )}
    </div>
  );
}
