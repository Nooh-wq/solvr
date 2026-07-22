"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  upsertHelpCenter,
  deleteHelpCenter,
  type HelpCenterDto,
} from "@/actions/helpCenters";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";

type Editing = HelpCenterDto | { create: true } | null;

const BLANK: HelpCenterDto = {
  id: "",
  slug: "",
  name: "",
  description: null,
  customDomain: null,
  isActive: true,
  communityEnabled: false,
  communityModerationDefault: true,
  communityUpvoteThreshold: 3,
  brandingJson: null,
  updatedAt: "",
};

export function HelpCentersManager({ centers }: { centers: HelpCenterDto[] }) {
  const router = useRouter();
  const { toast } = useToast();
  const [editing, setEditing] = useState<Editing>(null);
  const [pending, startTransition] = useTransition();

  function remove(id: string, name: string) {
    startTransition(async () => {
      try {
        await deleteHelpCenter(id);
        toast({ title: "Help center deleted", description: name, variant: "success" });
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
        onSave={(v) => {
          startTransition(async () => {
            try {
              await upsertHelpCenter(v);
              toast({ title: "Help center saved", description: v.name, variant: "success" });
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
          New help center
        </Button>
      </div>
      <div className="bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl overflow-hidden">
        {centers.length === 0 ? (
          <p className="p-8 text-center text-sm text-[var(--color-neutral-600)]">
            No help centers yet.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-[var(--color-light-gray)] text-[11px] uppercase-label text-[var(--color-neutral-700)]">
              <tr>
                <th className="text-left font-semibold px-4 py-2.5">Name</th>
                <th className="text-left font-semibold px-4 py-2.5">Slug</th>
                <th className="text-left font-semibold px-4 py-2.5">Custom domain</th>
                <th className="text-left font-semibold px-4 py-2.5">Community</th>
                <th className="text-left font-semibold px-4 py-2.5">Active</th>
                <th className="text-left font-semibold px-4 py-2.5"></th>
              </tr>
            </thead>
            <tbody>
              {centers.map((c) => (
                <tr key={c.id} className="border-t border-[var(--color-neutral-100)]">
                  <td className="px-4 py-3">
                    <button
                      onClick={() => setEditing(c)}
                      className="text-left text-[var(--color-primary)] font-medium"
                    >
                      {c.name}
                    </button>
                    {c.description ? (
                      <div className="text-[12px] text-[var(--color-neutral-600)]">
                        {c.description}
                      </div>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 font-mono text-[12px]">/help/{c.slug}</td>
                  <td className="px-4 py-3 text-[12px]">{c.customDomain ?? "—"}</td>
                  <td className="px-4 py-3">
                    {c.communityEnabled
                      ? `On (${c.communityModerationDefault ? "moderated" : "open"})`
                      : "Off"}
                  </td>
                  <td className="px-4 py-3">{c.isActive ? "Yes" : "No"}</td>
                  <td className="px-4 py-3">
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={pending}
                      onClick={() => remove(c.id, c.name)}
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
  initial: HelpCenterDto;
  isNew: boolean;
  pending: boolean;
  onCancel: () => void;
  onSave: (v: {
    id?: string;
    slug: string;
    name: string;
    description?: string | null;
    customDomain?: string | null;
    isActive: boolean;
    communityEnabled: boolean;
    communityModerationDefault: boolean;
    communityUpvoteThreshold: number;
    brandingJson?: { logoUrl?: string; primaryColor?: string } | null;
  }) => void;
}) {
  const [slug, setSlug] = useState(initial.slug);
  const [name, setName] = useState(initial.name);
  const [description, setDescription] = useState(initial.description ?? "");
  const [customDomain, setCustomDomain] = useState(initial.customDomain ?? "");
  const [isActive, setIsActive] = useState(initial.isActive);
  const [communityEnabled, setCommunityEnabled] = useState(initial.communityEnabled);
  const [communityModerationDefault, setCommunityModerationDefault] = useState(
    initial.communityModerationDefault
  );
  const [upvoteThreshold, setUpvoteThreshold] = useState(initial.communityUpvoteThreshold);

  return (
    <div className="bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl p-5 max-w-2xl space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label htmlFor="hcName">Name</Label>
          <Input id="hcName" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="hcSlug">URL slug</Label>
          <Input
            id="hcSlug"
            value={slug}
            onChange={(e) => setSlug(e.target.value.toLowerCase())}
            placeholder="product-a"
          />
        </div>
      </div>
      <div className="space-y-1">
        <Label htmlFor="hcDesc">Description</Label>
        <Textarea
          id="hcDesc"
          rows={2}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="hcDomain">Custom domain (optional)</Label>
        <Input
          id="hcDomain"
          value={customDomain}
          onChange={(e) => setCustomDomain(e.target.value)}
          placeholder="help.example.com"
        />
        <p className="text-[11px] text-[var(--color-neutral-500)]">
          Verified domain resolution is fail-closed — a mismatched host cannot serve articles.
        </p>
      </div>
      <label className="flex items-center gap-2 text-[13px]">
        <input
          type="checkbox"
          checked={isActive}
          onChange={(e) => setIsActive(e.target.checked)}
        />
        Active
      </label>
      <div className="border-t border-[var(--color-neutral-200)] pt-3 space-y-2">
        <div className="text-[12px] uppercase-label text-[var(--color-neutral-700)]">
          Community forum
        </div>
        <label className="flex items-center gap-2 text-[13px]">
          <input
            type="checkbox"
            checked={communityEnabled}
            onChange={(e) => setCommunityEnabled(e.target.checked)}
          />
          Enable community Q&amp;A
        </label>
        {communityEnabled ? (
          <>
            <label className="flex items-center gap-2 text-[13px]">
              <input
                type="checkbox"
                checked={communityModerationDefault}
                onChange={(e) => setCommunityModerationDefault(e.target.checked)}
              />
              Require moderator approval (recommended)
            </label>
            <div className="space-y-1 max-w-xs">
              <Label htmlFor="hcThreshold">Upvotes needed to feed KB suggestions</Label>
              <Input
                id="hcThreshold"
                type="number"
                min={1}
                max={100}
                value={upvoteThreshold}
                onChange={(e) => setUpvoteThreshold(Number(e.target.value))}
              />
            </div>
          </>
        ) : null}
      </div>
      <div className="flex gap-3">
        <Button
          disabled={pending || !slug.trim() || !name.trim()}
          onClick={() =>
            onSave({
              id: initial.id || undefined,
              slug,
              name,
              description: description.trim() || null,
              customDomain: customDomain.trim() || null,
              isActive,
              communityEnabled,
              communityModerationDefault,
              communityUpvoteThreshold: upvoteThreshold,
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
