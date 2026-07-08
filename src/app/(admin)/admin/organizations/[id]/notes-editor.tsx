"use client";

// Z4.2 — org-scoped notes editor. Auto-saves on blur / Cmd+S, same
// UX as the user profile notes editor.

import { useState, useTransition } from "react";
import { updateOrganizationNotes } from "@/actions/organizations";
import { useToast } from "@/components/ui/toast";

export function OrgNotesEditor({
  organizationId,
  initialNotes,
}: {
  organizationId: string;
  initialNotes: string;
}) {
  const { toast } = useToast();
  const [value, setValue] = useState(initialNotes);
  const [saved, setSaved] = useState(initialNotes);
  const [pending, startTransition] = useTransition();
  const dirty = value !== saved;

  function save() {
    if (!dirty) return;
    const next = value.trim();
    startTransition(async () => {
      const res = await updateOrganizationNotes({
        organizationId,
        notes: next.length === 0 ? null : next,
      });
      if ("ok" in res && res.ok) {
        setSaved(next);
      } else {
        toast({
          title: "Couldn't save note",
          description: "error" in res ? res.error : undefined,
          variant: "error",
        });
      }
    });
  }

  return (
    <div className="bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl p-5">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-[13px] font-semibold">Organization notes</h2>
        <span className="text-[11px] text-[var(--color-neutral-500)]">
          {pending ? "Saving…" : dirty ? "Unsaved" : "Saved"}
        </span>
      </div>
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "s") {
            e.preventDefault();
            save();
          }
        }}
        placeholder="Context that persists across every ticket from this org. Never shown to end users."
        rows={5}
        className="w-full text-[13px] p-2.5 rounded-lg bg-[var(--background)] border border-[var(--color-neutral-300)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30 resize-none"
      />
      <p className="text-[10px] text-[var(--color-neutral-500)] mt-1.5">
        Auto-saves on blur.
      </p>
    </div>
  );
}
