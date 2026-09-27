"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { upsertAsset, deleteAsset, type AssetDto } from "@/actions/assets";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";

const KINDS = ["LAPTOP", "MONITOR", "LICENSE", "ACCESS", "OTHER"] as const;
const STATUSES = ["IN_STOCK", "ASSIGNED", "RETIRED"] as const;

type Editing = AssetDto | { create: true } | null;

const BLANK: AssetDto = {
  id: "",
  assetTag: "",
  name: "",
  kind: "OTHER",
  status: "IN_STOCK",
  serialNumber: null,
  notes: null,
  assignedEndUserId: null,
  assignedTeamMemberId: null,
  updatedAt: "",
};

export function AssetsManager({ assets }: { assets: AssetDto[] }) {
  const router = useRouter();
  const { toast } = useToast();
  const [editing, setEditing] = useState<Editing>(null);
  const [pending, startTransition] = useTransition();

  function remove(id: string, tag: string) {
    startTransition(async () => {
      try {
        await deleteAsset(id);
        toast({ title: "Asset deleted", description: tag, variant: "success" });
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
        pending={pending}
        onCancel={() => setEditing(null)}
        onSave={(v) => {
          startTransition(async () => {
            try {
              await upsertAsset(v);
              toast({ title: "Asset saved", description: v.assetTag, variant: "success" });
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
          New asset
        </Button>
      </div>
      <div className="bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl overflow-hidden">
        {assets.length === 0 ? (
          <p className="p-8 text-center text-sm text-[var(--color-neutral-600)]">
            No assets yet.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-[var(--color-light-gray)] text-[11px] uppercase-label text-[var(--color-neutral-700)]">
              <tr>
                <th className="text-left font-semibold px-4 py-2.5">Tag</th>
                <th className="text-left font-semibold px-4 py-2.5">Name</th>
                <th className="text-left font-semibold px-4 py-2.5">Kind</th>
                <th className="text-left font-semibold px-4 py-2.5">Status</th>
                <th className="text-left font-semibold px-4 py-2.5"></th>
              </tr>
            </thead>
            <tbody>
              {assets.map((a) => (
                <tr key={a.id} className="border-t border-[var(--color-neutral-100)]">
                  <td className="px-4 py-3 font-mono">
                    <button
                      onClick={() => setEditing(a)}
                      className="text-[var(--color-primary)] font-medium"
                    >
                      {a.assetTag}
                    </button>
                  </td>
                  <td className="px-4 py-3">{a.name}</td>
                  <td className="px-4 py-3">{a.kind}</td>
                  <td className="px-4 py-3">{a.status}</td>
                  <td className="px-4 py-3">
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={pending}
                      onClick={() => remove(a.id, a.assetTag)}
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
  initial: AssetDto;
  pending: boolean;
  onCancel: () => void;
  onSave: (v: {
    id?: string;
    assetTag: string;
    name: string;
    kind: (typeof KINDS)[number];
    status: (typeof STATUSES)[number];
    serialNumber?: string | null;
    notes?: string | null;
    assignedEndUserId?: string | null;
    assignedTeamMemberId?: string | null;
  }) => void;
}) {
  const [tag, setTag] = useState(initial.assetTag);
  const [name, setName] = useState(initial.name);
  const [kind, setKind] = useState<(typeof KINDS)[number]>(initial.kind as (typeof KINDS)[number]);
  const [status, setStatus] = useState<(typeof STATUSES)[number]>(
    initial.status as (typeof STATUSES)[number]
  );
  const [serialNumber, setSerialNumber] = useState(initial.serialNumber ?? "");
  const [notes, setNotes] = useState(initial.notes ?? "");
  const [assignedEndUserId, setAssignedEndUserId] = useState(initial.assignedEndUserId ?? "");
  const [assignedTeamMemberId, setAssignedTeamMemberId] = useState(
    initial.assignedTeamMemberId ?? ""
  );

  return (
    <div className="bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl p-5 max-w-2xl space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label htmlFor="assetTag">Tag</Label>
          <Input id="assetTag" value={tag} onChange={(e) => setTag(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="assetName">Name</Label>
          <Input id="assetName" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="assetKind">Kind</Label>
          <select
            id="assetKind"
            value={kind}
            onChange={(e) => setKind(e.target.value as (typeof KINDS)[number])}
            className="h-10 w-full rounded-md border border-[var(--color-neutral-300)] bg-[var(--color-surface)] px-3 text-sm"
          >
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="assetStatus">Status</Label>
          <select
            id="assetStatus"
            value={status}
            onChange={(e) => setStatus(e.target.value as (typeof STATUSES)[number])}
            className="h-10 w-full rounded-md border border-[var(--color-neutral-300)] bg-[var(--color-surface)] px-3 text-sm"
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="space-y-1">
        <Label htmlFor="assetSerial">Serial (optional)</Label>
        <Input
          id="assetSerial"
          value={serialNumber}
          onChange={(e) => setSerialNumber(e.target.value)}
        />
      </div>

      {status === "ASSIGNED" ? (
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label htmlFor="assignEnd">Assigned end-user id</Label>
            <Input
              id="assignEnd"
              value={assignedEndUserId}
              onChange={(e) => {
                setAssignedEndUserId(e.target.value);
                if (e.target.value) setAssignedTeamMemberId("");
              }}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="assignTM">Assigned team-member id</Label>
            <Input
              id="assignTM"
              value={assignedTeamMemberId}
              onChange={(e) => {
                setAssignedTeamMemberId(e.target.value);
                if (e.target.value) setAssignedEndUserId("");
              }}
            />
          </div>
        </div>
      ) : null}

      <div className="space-y-1">
        <Label htmlFor="assetNotes">Notes (optional)</Label>
        <Textarea
          id="assetNotes"
          rows={3}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </div>

      <div className="flex gap-3">
        <Button
          disabled={pending || !tag.trim() || !name.trim()}
          onClick={() =>
            onSave({
              id: initial.id || undefined,
              assetTag: tag,
              name,
              kind,
              status,
              serialNumber: serialNumber.trim() || null,
              notes: notes.trim() || null,
              assignedEndUserId: assignedEndUserId.trim() || null,
              assignedTeamMemberId: assignedTeamMemberId.trim() || null,
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
