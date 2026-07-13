"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setTenantServiceMode } from "@/actions/serviceMode";
import { labelsFor, type ServiceMode } from "@/lib/service-mode/labels";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";

export function ServiceModeToggle({ initial }: { initial: ServiceMode }) {
  const router = useRouter();
  const { toast } = useToast();
  const [mode, setMode] = useState<ServiceMode>(initial);
  const [pending, startTransition] = useTransition();

  function save() {
    startTransition(async () => {
      try {
        await setTenantServiceMode({ mode });
        toast({
          title: `Service mode set to ${mode === "EMPLOYEE" ? "Employee" : "Customer"}`,
          variant: "success",
        });
        router.refresh();
      } catch (e) {
        toast({
          title: "Couldn't update",
          description: e instanceof Error ? e.message : undefined,
          variant: "error",
        });
      }
    });
  }

  const preview = labelsFor(mode);

  return (
    <div className="grid grid-cols-2 gap-4 max-w-3xl">
      {(["CUSTOMER", "EMPLOYEE"] as const).map((m) => {
        const isActive = mode === m;
        return (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            className={`text-left bg-[var(--color-surface)] rounded-2xl p-5 border-2 transition-colors cursor-pointer ${
              isActive
                ? "border-[var(--color-primary)]"
                : "border-[var(--color-neutral-300)] hover:border-[var(--color-neutral-500)]"
            }`}
          >
            <div className="text-[13px] font-semibold mb-2">
              {m === "EMPLOYEE" ? "Employee service" : "Customer support"}
            </div>
            <div className="text-[12px] text-[var(--color-neutral-600)] mb-3">
              {m === "EMPLOYEE"
                ? "Internal IT / HR. Portal leads with Service Catalog. Requests, approvals, assets."
                : "External customers. Classic ticket-first support. Categories + custom fields."}
            </div>
            <ul className="text-[12px] text-[var(--color-neutral-700)] space-y-1">
              <li>Ticket → <span className="font-medium">{labelsFor(m).ticket}</span></li>
              <li>Customer → <span className="font-medium">{labelsFor(m).customer}</span></li>
              <li>Category → <span className="font-medium">{labelsFor(m).category}</span></li>
            </ul>
          </button>
        );
      })}

      <div className="col-span-2 flex items-center gap-3">
        <Button disabled={pending || mode === initial} onClick={save}>
          {pending ? "Saving…" : mode === initial ? "No change" : "Save changes"}
        </Button>
        <p className="text-[12px] text-[var(--color-neutral-500)]">
          Preview labels update instantly above. Save to apply tenant-wide.
        </p>
        {mode === "EMPLOYEE" ? (
          <span className="ml-auto text-[11px] uppercase-label text-[var(--color-neutral-500)]">
            Portal home: {preview.catalog}
          </span>
        ) : null}
      </div>
    </div>
  );
}
