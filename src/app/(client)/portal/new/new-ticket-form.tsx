"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createTicket } from "@/actions/tickets";
import { resolveTicketFormForCategory } from "@/actions/ticketForms";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea, Select } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";

type FieldType = "TEXT" | "NUMBER" | "DATE" | "CHECKBOX" | "DROPDOWN" | "MULTISELECT";

type FormFieldMeta = {
  id: string;
  position: number;
  isRequiredOverride: boolean | null;
  visibleWhenFieldId: string | null;
  visibleWhenValue: string | null;
  definition: {
    id: string;
    key: string;
    label: string;
    type: string;
    isRequired: boolean;
    description: string | null;
    options: Array<{ id: string; value: string; label: string }>;
  };
};

type ResolvedForm = {
  id: string;
  name: string;
  fields: FormFieldMeta[];
};

type CustomValue = {
  valueText?: string;
  valueNumber?: number;
  valueDate?: string;
  valueBoolean?: boolean;
  valueOptionId?: string;
  valueOptionIds?: string[];
};

export function NewTicketForm({ categories }: { categories: { id: string; name: string }[] }) {
  const router = useRouter();
  const { toast } = useToast();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [categoryId, setCategoryId] = useState("");
  const [priority, setPriority] = useState<"LOW" | "MEDIUM" | "HIGH" | "URGENT">("MEDIUM");
  const [form, setForm] = useState<ResolvedForm | null>(null);
  const [values, setValues] = useState<Record<string, CustomValue>>({});

  useEffect(() => {
    let cancelled = false;
    if (!categoryId) {
      setForm(null);
      setValues({});
      return;
    }
    resolveTicketFormForCategory(categoryId).then((f) => {
      if (cancelled) return;
      setForm(f);
      setValues({});
    });
    return () => {
      cancelled = true;
    };
  }, [categoryId]);

  function setFieldValue(defId: string, patch: CustomValue) {
    setValues((prev) => ({ ...prev, [defId]: { ...prev[defId], ...patch } }));
  }

  // Z2.4 conditional visibility: when a field's visibleWhenFieldId +
  // visibleWhenValue are set, only render it if the parent's current value
  // matches. For DROPDOWN/MULTISELECT the stored `visibleWhenValue` is the
  // option id.
  function isFieldVisible(f: FormFieldMeta): boolean {
    if (!f.visibleWhenFieldId || !f.visibleWhenValue) return true;
    const parent = form?.fields.find((p) => p.id === f.visibleWhenFieldId);
    if (!parent) return true;
    const parentDefId = parent.definition.id;
    const parentVal = values[parentDefId];
    if (!parentVal) return false;
    switch (parent.definition.type) {
      case "DROPDOWN":
        return parentVal.valueOptionId === f.visibleWhenValue;
      case "MULTISELECT":
        return (parentVal.valueOptionIds ?? []).includes(f.visibleWhenValue);
      case "CHECKBOX":
        return String(parentVal.valueBoolean) === f.visibleWhenValue;
      case "TEXT":
        return (parentVal.valueText ?? "") === f.visibleWhenValue;
      case "NUMBER":
        return String(parentVal.valueNumber ?? "") === f.visibleWhenValue;
      case "DATE":
        return (parentVal.valueDate ?? "") === f.visibleWhenValue;
      default:
        return true;
    }
  }

  function isEffectivelyRequired(f: FormFieldMeta): boolean {
    if (f.isRequiredOverride !== null) return f.isRequiredOverride;
    return f.definition.isRequired;
  }

  function onSubmit(formData: FormData) {
    setError(null);

    // Build the custom-field payload. Only include values for fields that
    // are actually visible right now — hidden conditional fields must not
    // be submitted (they might not have valid values).
    const visible = (form?.fields ?? []).filter(isFieldVisible);
    const requiredMissing = visible
      .filter(isEffectivelyRequired)
      .filter((f) => {
        const v = values[f.definition.id];
        if (!v) return true;
        switch (f.definition.type) {
          case "TEXT":
            return !v.valueText;
          case "NUMBER":
            return v.valueNumber === undefined || v.valueNumber === null;
          case "DATE":
            return !v.valueDate;
          case "CHECKBOX":
            return v.valueBoolean === undefined;
          case "DROPDOWN":
            return !v.valueOptionId;
          case "MULTISELECT":
            return !v.valueOptionIds || v.valueOptionIds.length === 0;
          default:
            return false;
        }
      });
    if (requiredMissing.length > 0) {
      const label = requiredMissing[0].definition.label;
      setError(`${label} is required.`);
      return;
    }

    const customFieldValues = visible
      .filter((f) => values[f.definition.id])
      .map((f) => {
        const v = values[f.definition.id];
        return {
          fieldDefinitionId: f.definition.id,
          valueText: v.valueText ?? null,
          valueNumber: v.valueNumber ?? null,
          valueDate: v.valueDate ?? null,
          valueBoolean: v.valueBoolean ?? null,
          valueOptionId: v.valueOptionId ?? null,
          valueOptionIds: v.valueOptionIds ?? null,
        };
      });

    startTransition(async () => {
      const result = await createTicket({
        title: String(formData.get("title")),
        description: String(formData.get("description")),
        categoryId: categoryId || undefined,
        priority,
        ticketFormId: form?.id,
        customFieldValues,
      });
      if ("error" in result && result.error) {
        setError(result.error as string);
        toast({
          title: "Couldn't create ticket",
          description: result.error as string,
          variant: "error",
        });
        return;
      }
      toast({ title: "Ticket created", description: "We'll follow up soon.", variant: "success" });
      router.push("/portal");
    });
  }

  return (
    <form
      action={onSubmit}
      className="space-y-4 bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl p-6"
    >
      <div className="space-y-1.5">
        <Label htmlFor="title">Title</Label>
        <Input id="title" name="title" required minLength={3} placeholder="Short summary of the issue" />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="description">Description</Label>
        <Textarea
          id="description"
          name="description"
          required
          rows={6}
          placeholder="What's happening? Include steps to reproduce if relevant."
        />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="categoryId">Category</Label>
          <Select
            id="categoryId"
            name="categoryId"
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
          >
            <option value="">Select a category</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="priority">Priority</Label>
          <Select
            id="priority"
            name="priority"
            value={priority}
            onChange={(e) => setPriority(e.target.value as typeof priority)}
          >
            <option value="LOW">Low</option>
            <option value="MEDIUM">Medium</option>
            <option value="HIGH">High</option>
            <option value="URGENT">Urgent</option>
          </Select>
        </div>
      </div>

      {form && form.fields.length > 0 ? (
        <div className="rounded-xl border border-dashed border-[var(--color-neutral-300)] bg-[var(--color-neutral-100)]/40 p-4 space-y-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-[var(--color-neutral-500)]">
            {form.name}
          </div>
          {form.fields.filter(isFieldVisible).map((f) => (
            <FormFieldInput
              key={f.id}
              field={f}
              value={values[f.definition.id]}
              isRequired={isEffectivelyRequired(f)}
              onChange={(patch) => setFieldValue(f.definition.id, patch)}
            />
          ))}
        </div>
      ) : null}

      {error && <p className="text-[13px] text-red-600">{error}</p>}
      <Button type="submit" disabled={pending}>
        {pending ? "Submitting…" : "Submit ticket"}
      </Button>
    </form>
  );
}

function FormFieldInput({
  field,
  value,
  isRequired,
  onChange,
}: {
  field: FormFieldMeta;
  value: CustomValue | undefined;
  isRequired: boolean;
  onChange: (v: CustomValue) => void;
}) {
  const t = field.definition.type as FieldType;
  const label = (
    <Label>
      {field.definition.label}
      {isRequired ? <span className="text-red-600 ml-1">*</span> : null}
    </Label>
  );

  switch (t) {
    case "TEXT":
      return (
        <div className="space-y-1.5">
          {label}
          <Input
            value={value?.valueText ?? ""}
            onChange={(e) => onChange({ valueText: e.target.value })}
          />
          {field.definition.description ? (
            <div className="text-[11px] text-[var(--color-neutral-500)]">
              {field.definition.description}
            </div>
          ) : null}
        </div>
      );
    case "NUMBER":
      return (
        <div className="space-y-1.5">
          {label}
          <Input
            type="number"
            value={value?.valueNumber ?? ""}
            onChange={(e) =>
              onChange({
                valueNumber: e.target.value === "" ? undefined : Number(e.target.value),
              })
            }
          />
        </div>
      );
    case "DATE":
      return (
        <div className="space-y-1.5">
          {label}
          <Input
            type="date"
            value={value?.valueDate ?? ""}
            onChange={(e) => onChange({ valueDate: e.target.value })}
          />
        </div>
      );
    case "CHECKBOX":
      return (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={value?.valueBoolean ?? false}
            onChange={(e) => onChange({ valueBoolean: e.target.checked })}
          />
          {field.definition.label}
          {isRequired ? <span className="text-red-600 ml-1">*</span> : null}
        </label>
      );
    case "DROPDOWN":
      return (
        <div className="space-y-1.5">
          {label}
          <Select
            value={value?.valueOptionId ?? ""}
            onChange={(e) => onChange({ valueOptionId: e.target.value || undefined })}
          >
            <option value="">Select…</option>
            {field.definition.options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </Select>
        </div>
      );
    case "MULTISELECT":
      return (
        <div className="space-y-1.5">
          {label}
          <div className="flex flex-wrap gap-2">
            {field.definition.options.map((o) => {
              const selected = (value?.valueOptionIds ?? []).includes(o.id);
              return (
                <button
                  type="button"
                  key={o.id}
                  onClick={() => {
                    const cur = value?.valueOptionIds ?? [];
                    const next = selected ? cur.filter((x) => x !== o.id) : [...cur, o.id];
                    onChange({ valueOptionIds: next });
                  }}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors cursor-pointer ${
                    selected
                      ? "bg-[var(--color-primary)] text-white border-[var(--color-primary)]"
                      : "bg-[var(--color-surface)] border-[var(--color-neutral-300)] hover:bg-[var(--color-light-gray)]"
                  }`}
                >
                  {o.label}
                </button>
              );
            })}
          </div>
        </div>
      );
    default:
      return null;
  }
}
