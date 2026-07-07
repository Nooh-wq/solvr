"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import {
  updateTicketForm,
  addFieldToForm,
  removeFieldFromForm,
  updateFormField,
  setFormCategories,
} from "@/actions/ticketForms";

type FieldType =
  | "TEXT"
  | "NUMBER"
  | "DATE"
  | "CHECKBOX"
  | "DROPDOWN"
  | "MULTISELECT"
  | "USER_LOOKUP"
  | "ORG_LOOKUP";

type FormFieldRow = {
  id: string;
  position: number;
  isRequiredOverride: boolean | null;
  visibleWhenFieldId: string | null;
  visibleWhenValue: string | null;
  definition: {
    id: string;
    key: string;
    label: string;
    type: FieldType;
    isRequired: boolean;
    options: Array<{ id: string; value: string; label: string }>;
  };
};

type DefinitionRow = {
  id: string;
  key: string;
  label: string;
  type: FieldType;
};

type CategoryRow = { id: string; name: string };

type FormData = {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  fields: FormFieldRow[];
  categoryIds: string[];
};

const TYPE_LABEL: Record<FieldType, string> = {
  TEXT: "Text",
  NUMBER: "Number",
  DATE: "Date",
  CHECKBOX: "Checkbox",
  DROPDOWN: "Dropdown",
  MULTISELECT: "Multiselect",
  USER_LOOKUP: "User lookup",
  ORG_LOOKUP: "Organization lookup",
};

export function FormEditor({
  form,
  allTicketDefs,
  allCategories,
}: {
  form: FormData;
  allTicketDefs: DefinitionRow[];
  allCategories: CategoryRow[];
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();

  const [name, setName] = useState(form.name);
  const [description, setDescription] = useState(form.description ?? "");
  const [addingDef, setAddingDef] = useState("");

  const usedDefIds = new Set(form.fields.map((f) => f.definition.id));
  const availableDefs = allTicketDefs.filter((d) => !usedDefIds.has(d.id));

  function saveMeta() {
    startTransition(async () => {
      await updateTicketForm({
        id: form.id,
        name: name.trim(),
        description: description.trim() ? description.trim() : null,
      });
      toast({ title: "Form saved", variant: "success" });
      router.refresh();
    });
  }

  function addField() {
    if (!addingDef) return;
    startTransition(async () => {
      const r = await addFieldToForm({
        ticketFormId: form.id,
        fieldDefinitionId: addingDef,
        position: form.fields.length,
      });
      if (!r.ok) {
        toast({ title: "Couldn't add field", description: r.error, variant: "error" });
        return;
      }
      setAddingDef("");
      toast({ title: "Field added", variant: "success" });
      router.refresh();
    });
  }

  function removeField(id: string) {
    startTransition(async () => {
      try {
        await removeFieldFromForm(id);
        toast({ title: "Field removed", variant: "success" });
        router.refresh();
      } catch (e) {
        toast({
          title: "Couldn't remove",
          description: e instanceof Error ? e.message : undefined,
          variant: "error",
        });
      }
    });
  }

  function toggleRequired(field: FormFieldRow) {
    // Cycle: null (inherit) → true (force required) → false (force optional) → null
    const next =
      field.isRequiredOverride === null
        ? true
        : field.isRequiredOverride === true
          ? false
          : null;
    startTransition(async () => {
      await updateFormField({ id: field.id, isRequiredOverride: next });
      router.refresh();
    });
  }

  function saveVisibility(field: FormFieldRow, whenId: string | null, whenValue: string | null) {
    startTransition(async () => {
      try {
        await updateFormField({
          id: field.id,
          visibleWhenFieldId: whenId,
          visibleWhenValue: whenValue,
        });
        toast({ title: "Rule saved", variant: "success" });
        router.refresh();
      } catch (e) {
        toast({
          title: "Couldn't save rule",
          description: e instanceof Error ? e.message : undefined,
          variant: "error",
        });
      }
    });
  }

  function toggleCategory(id: string) {
    const next = form.categoryIds.includes(id)
      ? form.categoryIds.filter((c) => c !== id)
      : [...form.categoryIds, id];
    startTransition(async () => {
      await setFormCategories({ ticketFormId: form.id, categoryIds: next });
      router.refresh();
    });
  }

  function effectiveRequiredLabel(field: FormFieldRow): string {
    if (field.isRequiredOverride === true) return "Required (override)";
    if (field.isRequiredOverride === false) return "Optional (override)";
    return field.definition.isRequired ? "Required (default)" : "Optional (default)";
  }

  return (
    <div className="max-w-3xl space-y-6">
      {/* Meta */}
      <div className="bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl p-5">
        <div className="text-sm font-semibold mb-4">Form details</div>
        <div className="space-y-3">
          <label className="block">
            <div className="text-xs font-medium mb-1">Name</div>
            <Input value={name} onChange={(e) => setName(e.target.value)} onBlur={saveMeta} />
          </label>
          <label className="block">
            <div className="text-xs font-medium mb-1">Description</div>
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              onBlur={saveMeta}
            />
          </label>
        </div>
      </div>

      {/* Fields */}
      <div className="bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="text-sm font-semibold">Fields on this form</div>
        </div>
        {form.fields.length === 0 ? (
          <div className="text-sm text-[var(--color-neutral-500)] py-4">
            No fields yet. Add one below to include it on the client&apos;s intake form.
          </div>
        ) : (
          <div className="space-y-2 mb-4">
            {form.fields.map((f) => (
              <div
                key={f.id}
                className="rounded-xl border border-[var(--color-neutral-200)] p-3 space-y-2"
              >
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-sm">{f.definition.label}</span>
                  <code className="text-[11px] px-1.5 py-0.5 rounded bg-[var(--color-neutral-100)] text-[var(--color-neutral-600)]">
                    {f.definition.key}
                  </code>
                  <span className="text-[10px] font-semibold uppercase tracking-wide bg-[var(--color-neutral-100)] text-[var(--color-neutral-700)] rounded-full px-2 py-0.5">
                    {TYPE_LABEL[f.definition.type]}
                  </span>
                  <button
                    type="button"
                    className="text-[10px] font-semibold uppercase tracking-wide rounded-full px-2 py-0.5 bg-[var(--color-orange-pale)] text-[var(--color-orange-deep)] cursor-pointer"
                    onClick={() => toggleRequired(f)}
                  >
                    {effectiveRequiredLabel(f)}
                  </button>
                  <div className="ml-auto">
                    <Button variant="ghost" size="sm" onClick={() => removeField(f.id)}>
                      Remove
                    </Button>
                  </div>
                </div>

                {/* Z2.4 — conditional visibility rule */}
                <VisibilityRuleEditor
                  field={f}
                  siblings={form.fields.filter((s) => s.id !== f.id)}
                  onSave={(whenId, whenValue) => saveVisibility(f, whenId, whenValue)}
                />
              </div>
            ))}
          </div>
        )}

        <div className="flex items-end gap-2 pt-3 border-t border-[var(--color-neutral-200)]">
          <label className="flex-1">
            <div className="text-xs font-medium mb-1">Add ticket field</div>
            <select
              value={addingDef}
              onChange={(e) => setAddingDef(e.target.value)}
              className="w-full h-9 rounded-lg border border-[var(--color-neutral-300)] bg-[var(--color-surface)] px-3 text-sm"
            >
              <option value="">
                {availableDefs.length === 0
                  ? "All active ticket fields are already on this form"
                  : "Pick a field…"}
              </option>
              {availableDefs.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.label} — {d.key}
                </option>
              ))}
            </select>
          </label>
          <Button size="sm" disabled={pending || !addingDef} onClick={addField}>
            Add
          </Button>
        </div>
      </div>

      {/* Categories */}
      <div className="bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl p-5">
        <div className="text-sm font-semibold mb-1">Categories</div>
        <div className="text-xs text-[var(--color-neutral-500)] mb-4">
          When a client picks one of these categories on the portal, this form is used.
        </div>
        {allCategories.length === 0 ? (
          <div className="text-sm text-[var(--color-neutral-500)]">
            No categories exist yet.
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {allCategories.map((c) => {
              const checked = form.categoryIds.includes(c.id);
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => toggleCategory(c.id)}
                  disabled={pending}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors cursor-pointer ${
                    checked
                      ? "bg-[var(--color-primary)] text-white border-[var(--color-primary)]"
                      : "bg-[var(--color-surface)] border-[var(--color-neutral-300)] text-[var(--foreground)] hover:bg-[var(--color-light-gray)]"
                  }`}
                >
                  {c.name}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function VisibilityRuleEditor({
  field,
  siblings,
  onSave,
}: {
  field: FormFieldRow;
  siblings: FormFieldRow[];
  onSave: (whenId: string | null, whenValue: string | null) => void;
}) {
  const [whenId, setWhenId] = useState(field.visibleWhenFieldId ?? "");
  const [whenValue, setWhenValue] = useState(field.visibleWhenValue ?? "");

  const parent = siblings.find((s) => s.id === whenId);
  const parentType = parent?.definition.type;

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs pt-1">
      <span className="text-[var(--color-neutral-500)]">Show when</span>
      <select
        value={whenId}
        onChange={(e) => setWhenId(e.target.value)}
        className="h-7 rounded-md border border-[var(--color-neutral-300)] bg-[var(--color-surface)] px-2"
      >
        <option value="">Always</option>
        {siblings.map((s) => (
          <option key={s.id} value={s.id}>
            {s.definition.label}
          </option>
        ))}
      </select>
      {whenId ? (
        <>
          <span className="text-[var(--color-neutral-500)]">equals</span>
          {parentType === "DROPDOWN" || parentType === "MULTISELECT" ? (
            <select
              value={whenValue}
              onChange={(e) => setWhenValue(e.target.value)}
              className="h-7 rounded-md border border-[var(--color-neutral-300)] bg-[var(--color-surface)] px-2"
            >
              <option value="">Pick a value…</option>
              {parent?.definition.options.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
          ) : parentType === "CHECKBOX" ? (
            <select
              value={whenValue}
              onChange={(e) => setWhenValue(e.target.value)}
              className="h-7 rounded-md border border-[var(--color-neutral-300)] bg-[var(--color-surface)] px-2"
            >
              <option value="">Pick a value…</option>
              <option value="true">Checked</option>
              <option value="false">Unchecked</option>
            </select>
          ) : (
            <Input
              value={whenValue}
              onChange={(e) => setWhenValue(e.target.value)}
              className="h-7 !py-0"
            />
          )}
        </>
      ) : null}
      <Button
        variant="ghost"
        size="sm"
        onClick={() => onSave(whenId || null, whenId ? whenValue || null : null)}
      >
        Save rule
      </Button>
    </div>
  );
}
