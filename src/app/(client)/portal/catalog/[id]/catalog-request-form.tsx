"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { submitCatalogRequest } from "@/actions/serviceCatalog";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";

type Field = {
  id: string;
  key: string;
  label: string;
  description: string | null;
  type: string;
  isRequired: boolean;
  options: Array<{ id: string; label: string; value: string }>;
};

export function CatalogRequestForm({
  catalogItemId,
  fields,
}: {
  catalogItemId: string;
  fields: Field[];
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [answers, setAnswers] = useState<Record<string, string | number | boolean | null>>({});
  const [pending, startTransition] = useTransition();

  function set(id: string, value: string | number | boolean | null) {
    setAnswers((prev) => ({ ...prev, [id]: value }));
  }

  function submit() {
    startTransition(async () => {
      try {
        const r = await submitCatalogRequest({ catalogItemId, answers });
        toast({
          title: r.approvalId ? "Request filed for approval" : "Request submitted",
          description: r.ticketReference,
          variant: "success",
        });
        router.push(`/portal/tickets/${r.ticketId}`);
      } catch (e) {
        toast({
          title: "Couldn't submit",
          description: e instanceof Error ? e.message : undefined,
          variant: "error",
        });
      }
    });
  }

  return (
    <div className="space-y-4 bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl p-5">
      {fields.length === 0 ? (
        <p className="text-[13px] text-[var(--color-neutral-600)]">
          No extra info needed — just submit.
        </p>
      ) : (
        fields.map((f) => (
          <div key={f.id} className="space-y-1">
            <Label htmlFor={`f-${f.id}`}>
              {f.label}
              {f.isRequired ? <span className="text-red-500 ml-1">*</span> : null}
            </Label>
            {f.description ? (
              <p className="text-[11px] text-[var(--color-neutral-500)]">{f.description}</p>
            ) : null}
            <FieldInput field={f} value={answers[f.id]} onChange={(v) => set(f.id, v)} />
          </div>
        ))
      )}
      <div className="flex gap-2 pt-3 border-t border-[var(--color-neutral-200)]">
        <Button disabled={pending} onClick={submit}>
          {pending ? "Submitting…" : "Submit request"}
        </Button>
      </div>
    </div>
  );
}

function FieldInput({
  field,
  value,
  onChange,
}: {
  field: Field;
  value: string | number | boolean | null | undefined;
  onChange: (v: string | number | boolean | null) => void;
}) {
  if (field.type === "TEXTAREA") {
    return (
      <Textarea
        id={`f-${field.id}`}
        rows={3}
        value={typeof value === "string" ? value : ""}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }
  if (field.type === "NUMBER") {
    return (
      <Input
        id={`f-${field.id}`}
        type="number"
        value={typeof value === "number" ? value : ""}
        onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
      />
    );
  }
  if (field.type === "BOOLEAN") {
    return (
      <label className="flex items-center gap-2 text-[13px]">
        <input
          type="checkbox"
          checked={value === true}
          onChange={(e) => onChange(e.target.checked)}
        />
        Yes
      </label>
    );
  }
  if (field.type === "DROPDOWN") {
    return (
      <select
        id={`f-${field.id}`}
        value={typeof value === "string" ? value : ""}
        onChange={(e) => onChange(e.target.value || null)}
        className="h-9 rounded-md border border-[var(--color-neutral-300)] bg-[var(--color-surface)] px-2 text-sm w-full"
      >
        <option value="">— pick one —</option>
        {field.options.map((o) => (
          <option key={o.id} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    );
  }
  // TEXT, USER_LOOKUP, ORG_LOOKUP, MULTISELECT — fall back to text.
  return (
    <Input
      id={`f-${field.id}`}
      value={typeof value === "string" ? value : ""}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}
