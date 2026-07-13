"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  upsertCatalogItem,
  deleteCatalogItem,
  type CatalogItemDto,
} from "@/actions/serviceCatalog";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";

type CustomField = { id: string; label: string; scope: string; type: string };
type Group = { id: string; name: string };
type TeamMember = { id: string; name: string };

type Editing = CatalogItemDto | { create: true } | null;

const BLANK: CatalogItemDto = {
  id: "",
  name: "",
  description: "",
  iconEmoji: null,
  isActive: true,
  requiresApproval: false,
  approverSubjectIds: [],
  approvalTimeoutHours: 72,
  formFieldDefIds: [],
  routingGroupId: null,
  position: 0,
  updatedAt: "",
};

export function CatalogEditor({
  items,
  customFields,
  groups,
  teamMembers,
}: {
  items: CatalogItemDto[];
  customFields: CustomField[];
  groups: Group[];
  teamMembers: TeamMember[];
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [editing, setEditing] = useState<Editing>(null);
  const [pending, startTransition] = useTransition();

  function remove(id: string, name: string) {
    startTransition(async () => {
      try {
        await deleteCatalogItem(id);
        toast({ title: "Catalog item deleted", description: name, variant: "success" });
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
        customFields={customFields}
        groups={groups}
        teamMembers={teamMembers}
        pending={pending}
        onCancel={() => setEditing(null)}
        onSave={(values) => {
          startTransition(async () => {
            try {
              await upsertCatalogItem(values);
              toast({ title: "Catalog item saved", description: values.name, variant: "success" });
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
      <div className="flex justify-end mb-4">
        <Button size="sm" onClick={() => setEditing({ create: true })}>
          New catalog item
        </Button>
      </div>
      <div className="bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl overflow-hidden">
        {items.length === 0 ? (
          <p className="p-8 text-center text-sm text-[var(--color-neutral-600)]">
            No catalog items yet.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-[var(--color-light-gray)] text-[11px] uppercase-label text-[var(--color-neutral-700)]">
              <tr>
                <th className="text-left font-semibold px-4 py-2.5">Name</th>
                <th className="text-left font-semibold px-4 py-2.5">Fields</th>
                <th className="text-left font-semibold px-4 py-2.5">Approval</th>
                <th className="text-left font-semibold px-4 py-2.5">Active</th>
                <th className="text-left font-semibold px-4 py-2.5"></th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.id} className="border-t border-[var(--color-neutral-100)]">
                  <td className="px-4 py-3">
                    <button
                      onClick={() => setEditing(it)}
                      className="text-left text-[var(--color-primary)] font-medium"
                    >
                      {it.iconEmoji ? <span className="mr-1">{it.iconEmoji}</span> : null}
                      {it.name}
                    </button>
                    <div className="text-[12px] text-[var(--color-neutral-600)]">
                      {it.description}
                    </div>
                  </td>
                  <td className="px-4 py-3">{it.formFieldDefIds.length}</td>
                  <td className="px-4 py-3">
                    {it.requiresApproval
                      ? `${it.approverSubjectIds.length}-step (${it.approvalTimeoutHours}h)`
                      : "None"}
                  </td>
                  <td className="px-4 py-3">{it.isActive ? "Yes" : "No"}</td>
                  <td className="px-4 py-3">
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={pending}
                      onClick={() => remove(it.id, it.name)}
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
  customFields,
  groups,
  teamMembers,
  pending,
  onCancel,
  onSave,
}: {
  initial: CatalogItemDto;
  customFields: CustomField[];
  groups: Group[];
  teamMembers: TeamMember[];
  pending: boolean;
  onCancel: () => void;
  onSave: (values: {
    id?: string;
    name: string;
    description: string;
    iconEmoji?: string | null;
    isActive: boolean;
    requiresApproval: boolean;
    approverSubjectIds: string[];
    approvalTimeoutHours: number;
    formFieldDefIds: string[];
    routingGroupId?: string | null;
    position: number;
  }) => void;
}) {
  const [name, setName] = useState(initial.name);
  const [description, setDescription] = useState(initial.description);
  const [iconEmoji, setIconEmoji] = useState(initial.iconEmoji ?? "");
  const [isActive, setIsActive] = useState(initial.isActive);
  const [requiresApproval, setRequiresApproval] = useState(initial.requiresApproval);
  const [approvers, setApprovers] = useState<string[]>(initial.approverSubjectIds);
  const [approvalTimeoutHours, setApprovalTimeoutHours] = useState(initial.approvalTimeoutHours);
  const [selectedFieldIds, setSelectedFieldIds] = useState<string[]>(initial.formFieldDefIds);
  const [routingGroupId, setRoutingGroupId] = useState(initial.routingGroupId ?? "");
  const [position, setPosition] = useState(initial.position);

  function toggleField(id: string) {
    setSelectedFieldIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  function moveApproverUp(i: number) {
    if (i === 0) return;
    setApprovers((prev) => {
      const next = [...prev];
      [next[i - 1], next[i]] = [next[i], next[i - 1]];
      return next;
    });
  }
  function removeApprover(i: number) {
    setApprovers((prev) => prev.filter((_, ix) => ix !== i));
  }
  function addApprover(id: string) {
    if (!id || approvers.includes(id)) return;
    setApprovers((prev) => [...prev, id]);
  }

  const memberName = (id: string) =>
    teamMembers.find((m) => m.id === id)?.name ?? id.slice(0, 8);

  return (
    <div className="bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl p-5 max-w-3xl space-y-4">
      <div className="grid grid-cols-12 gap-3">
        <div className="col-span-1 space-y-1">
          <Label htmlFor="catIcon">Icon</Label>
          <Input
            id="catIcon"
            value={iconEmoji}
            onChange={(e) => setIconEmoji(e.target.value)}
            placeholder="💻"
          />
        </div>
        <div className="col-span-7 space-y-1">
          <Label htmlFor="catName">Name</Label>
          <Input id="catName" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="col-span-2 space-y-1">
          <Label htmlFor="catPos">Order</Label>
          <Input
            id="catPos"
            type="number"
            min={0}
            value={position}
            onChange={(e) => setPosition(Number(e.target.value))}
          />
        </div>
        <label className="col-span-2 flex items-end gap-2 text-[13px]">
          <input
            type="checkbox"
            checked={isActive}
            onChange={(e) => setIsActive(e.target.checked)}
          />
          Active
        </label>
      </div>

      <div className="space-y-1">
        <Label htmlFor="catDesc">Description (shown to employees)</Label>
        <Textarea
          id="catDesc"
          rows={2}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>

      <div className="space-y-2 border-t border-[var(--color-neutral-200)] pt-4">
        <div className="text-[12px] uppercase-label text-[var(--color-neutral-700)]">
          Form fields
        </div>
        <div className="text-[12px] text-[var(--color-neutral-600)] mb-2">
          Pick which of your custom fields to render on the request form. Order in the picker mirrors the form.
        </div>
        <div className="grid grid-cols-2 gap-2 text-[13px] max-h-52 overflow-y-auto p-2 border border-[var(--color-neutral-200)] rounded-md">
          {customFields.length === 0 ? (
            <div className="col-span-2 text-[var(--color-neutral-500)]">
              No custom fields yet — create some in Admin → Custom fields.
            </div>
          ) : (
            customFields.map((f) => (
              <label key={f.id} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={selectedFieldIds.includes(f.id)}
                  onChange={() => toggleField(f.id)}
                />
                <span>
                  <span className="text-[11px] text-[var(--color-neutral-500)] mr-1">
                    {f.scope}
                  </span>
                  {f.label}
                </span>
              </label>
            ))
          )}
        </div>
      </div>

      <div className="space-y-2 border-t border-[var(--color-neutral-200)] pt-4">
        <label className="flex items-center gap-2 text-[13px]">
          <input
            type="checkbox"
            checked={requiresApproval}
            onChange={(e) => setRequiresApproval(e.target.checked)}
          />
          Requires approval
        </label>

        {requiresApproval ? (
          <div className="space-y-2">
            <div className="text-[12px] text-[var(--color-neutral-600)]">
              Approvers in order — step N+1 is only asked after step N approves.
            </div>
            {approvers.map((id, i) => (
              <div key={id} className="flex items-center gap-2">
                <span className="text-[12px] text-[var(--color-neutral-500)] w-6">{i + 1}.</span>
                <span className="text-[13px] flex-1">{memberName(id)}</span>
                <Button size="sm" variant="secondary" onClick={() => moveApproverUp(i)}>
                  ↑
                </Button>
                <Button size="sm" variant="secondary" onClick={() => removeApprover(i)}>
                  ✕
                </Button>
              </div>
            ))}
            <div className="flex items-center gap-2">
              <select
                onChange={(e) => {
                  addApprover(e.target.value);
                  e.currentTarget.value = "";
                }}
                className="h-9 rounded-md border border-[var(--color-neutral-300)] bg-[var(--color-surface)] px-2 text-sm flex-1"
              >
                <option value="">Add approver…</option>
                {teamMembers
                  .filter((m) => !approvers.includes(m.id))
                  .map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
              </select>
              <div className="space-y-1">
                <Label htmlFor="catTimeout" className="text-[11px]">
                  Expire after
                </Label>
                <div className="flex items-center gap-1">
                  <Input
                    id="catTimeout"
                    type="number"
                    min={1}
                    max={720}
                    value={approvalTimeoutHours}
                    onChange={(e) => setApprovalTimeoutHours(Number(e.target.value))}
                    className="w-20"
                  />
                  <span className="text-[12px] text-[var(--color-neutral-600)]">hours</span>
                </div>
              </div>
            </div>
          </div>
        ) : null}
      </div>

      <div className="space-y-1 border-t border-[var(--color-neutral-200)] pt-4">
        <Label htmlFor="catRoute">Auto-route to group (optional)</Label>
        <select
          id="catRoute"
          value={routingGroupId}
          onChange={(e) => setRoutingGroupId(e.target.value)}
          className="h-9 rounded-md border border-[var(--color-neutral-300)] bg-[var(--color-surface)] px-2 text-sm"
        >
          <option value="">— none —</option>
          {groups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
      </div>

      <div className="flex gap-3 border-t border-[var(--color-neutral-200)] pt-4">
        <Button
          disabled={pending || !name.trim() || !description.trim()}
          onClick={() =>
            onSave({
              id: initial.id || undefined,
              name,
              description,
              iconEmoji: iconEmoji.trim() || null,
              isActive,
              requiresApproval,
              approverSubjectIds: approvers,
              approvalTimeoutHours,
              formFieldDefIds: selectedFieldIds,
              routingGroupId: routingGroupId || null,
              position,
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
