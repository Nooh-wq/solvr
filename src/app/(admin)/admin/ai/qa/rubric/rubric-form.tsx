"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { upsertQaRubric, seedDefaultRubric, deleteQaRubric, type RubricDto } from "@/actions/qaRubric";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";

type Editing = RubricDto | { create: true } | null;

const BLANK: RubricDto = {
  id: "",
  name: "",
  dimensions: [
    {
      key: "helpfulness",
      label: "Helpfulness",
      description: "Did the reply resolve the customer's question or move it forward?",
      weight: 3,
      flagBelow: 3,
    },
  ],
  isActive: true,
  updatedAt: "",
};

export function RubricForm({ rubrics }: { rubrics: RubricDto[] }) {
  const router = useRouter();
  const { toast } = useToast();
  const [editing, setEditing] = useState<Editing>(null);
  const [pending, startTransition] = useTransition();

  function seed() {
    startTransition(async () => {
      try {
        const r = await seedDefaultRubric();
        toast({
          title: r.created ? "Seeded default rubric" : "A rubric already exists",
          variant: r.created ? "success" : "error",
        });
        router.refresh();
      } catch (e) {
        toast({
          title: "Seed failed",
          description: e instanceof Error ? e.message : undefined,
          variant: "error",
        });
      }
    });
  }

  function remove(id: string, name: string) {
    startTransition(async () => {
      try {
        await deleteQaRubric(id);
        toast({ title: "Rubric deleted", description: name, variant: "success" });
        router.refresh();
      } catch (e) {
        toast({
          title: "Couldn't delete",
          description: e instanceof Error ? e.message : undefined,
          variant: "error",
        });
      }
    });
  }

  if (editing) {
    const initial = "create" in editing ? BLANK : editing;
    return (
      <Editor
        initial={initial}
        isNew={"create" in editing}
        pending={pending}
        onCancel={() => setEditing(null)}
        onSave={(values) => {
          startTransition(async () => {
            try {
              await upsertQaRubric(values);
              toast({ title: "Rubric saved", description: values.name, variant: "success" });
              setEditing(null);
              router.refresh();
            } catch (e) {
              toast({
                title: "Couldn't save",
                description: e instanceof Error ? e.message : undefined,
                variant: "error",
              });
            }
          });
        }}
      />
    );
  }

  return (
    <div>
      <div className="flex justify-end gap-2 mb-4">
        <Button variant="secondary" size="sm" onClick={seed} disabled={pending}>
          Seed default
        </Button>
        <Button size="sm" onClick={() => setEditing({ create: true })}>
          New rubric
        </Button>
      </div>
      <div className="bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl overflow-hidden">
        {rubrics.length === 0 ? (
          <p className="p-8 text-center text-sm text-[var(--color-neutral-600)]">
            No rubrics. Click &quot;Seed default&quot; for the starter helpfulness / tone / accuracy / compliance rubric.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-[var(--color-light-gray)] text-[11px] uppercase-label text-[var(--color-neutral-700)]">
              <tr>
                <th className="text-left font-semibold px-4 py-2.5">Name</th>
                <th className="text-left font-semibold px-4 py-2.5">Dimensions</th>
                <th className="text-left font-semibold px-4 py-2.5">Active</th>
                <th className="text-left font-semibold px-4 py-2.5"></th>
              </tr>
            </thead>
            <tbody>
              {rubrics.map((r) => (
                <tr key={r.id} className="border-t border-[var(--color-neutral-100)]">
                  <td className="px-4 py-3">
                    <button
                      onClick={() => setEditing(r)}
                      className="text-left text-[var(--color-primary)] font-medium"
                    >
                      {r.name}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-[var(--color-neutral-700)]">
                    {r.dimensions.map((d) => d.label).join(" · ")}
                  </td>
                  <td className="px-4 py-3">{r.isActive ? "Yes" : "No"}</td>
                  <td className="px-4 py-3">
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={pending}
                      onClick={() => remove(r.id, r.name)}
                    >
                      Delete
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function Editor({
  initial,
  pending,
  onCancel,
  onSave,
}: {
  initial: RubricDto;
  isNew: boolean;
  pending: boolean;
  onCancel: () => void;
  onSave: (values: {
    id?: string;
    name: string;
    dimensions: RubricDto["dimensions"];
    isActive: boolean;
  }) => void;
}) {
  const [name, setName] = useState(initial.name);
  const [isActive, setIsActive] = useState(initial.isActive);
  const [dims, setDims] = useState<RubricDto["dimensions"]>(initial.dimensions);

  function update(i: number, patch: Partial<RubricDto["dimensions"][number]>) {
    setDims((prev) => prev.map((d, ix) => (ix === i ? { ...d, ...patch } : d)));
  }
  function addRow() {
    setDims((prev) => [
      ...prev,
      { key: "new_dimension", label: "New dimension", description: "…", weight: 1, flagBelow: 3 },
    ]);
  }
  function removeRow(i: number) {
    setDims((prev) => prev.filter((_, ix) => ix !== i));
  }

  return (
    <div className="bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl p-5 max-w-3xl space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <div className="col-span-2 space-y-1">
          <Label htmlFor="rubricName">Name</Label>
          <Input id="rubricName" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <label className="flex items-end gap-2 text-[13px]">
          <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
          Active
        </label>
      </div>

      <div className="space-y-3">
        {dims.map((d, i) => (
          <div
            key={i}
            className="grid grid-cols-12 gap-2 border-t border-[var(--color-neutral-200)] pt-3"
          >
            <div className="col-span-3 space-y-1">
              <Label>Key</Label>
              <Input value={d.key} onChange={(e) => update(i, { key: e.target.value })} />
            </div>
            <div className="col-span-3 space-y-1">
              <Label>Label</Label>
              <Input value={d.label} onChange={(e) => update(i, { label: e.target.value })} />
            </div>
            <div className="col-span-6 space-y-1">
              <Label>Description (sent to the AI)</Label>
              <Textarea
                rows={2}
                value={d.description}
                onChange={(e) => update(i, { description: e.target.value })}
              />
            </div>
            <div className="col-span-3 space-y-1">
              <Label>Weight</Label>
              <Input
                type="number"
                step="0.5"
                min={0}
                max={10}
                value={d.weight}
                onChange={(e) => update(i, { weight: Number(e.target.value) })}
              />
            </div>
            <div className="col-span-3 space-y-1">
              <Label>Flag below</Label>
              <Input
                type="number"
                step="0.5"
                min={0}
                max={5}
                value={d.flagBelow}
                onChange={(e) => update(i, { flagBelow: Number(e.target.value) })}
              />
            </div>
            <div className="col-span-6 flex items-end">
              <Button variant="secondary" size="sm" onClick={() => removeRow(i)}>
                Remove
              </Button>
            </div>
          </div>
        ))}
        <Button variant="secondary" size="sm" onClick={addRow}>
          Add dimension
        </Button>
      </div>

      <div className="flex gap-3 border-t border-[var(--color-neutral-200)] pt-4">
        <Button
          disabled={pending || !name.trim() || dims.length === 0}
          onClick={() =>
            onSave({
              id: initial.id || undefined,
              name,
              dimensions: dims,
              isActive,
            })
          }
        >
          {pending ? "Saving…" : "Save"}
        </Button>
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
