"use client";

// Z3.3 — inline notes editor. Auto-saves on blur / Cmd+S; toasts on
// failure only (silent on success — save affordance is the "Saved"
// state indicator, same UX as Notion-style pads).

import { useState, useTransition } from "react";
import { updateUserNotes } from "@/actions/userProfile";
import { useToast } from "@/components/ui/toast";

export function NotesEditor({
  userId,
  initialNotes,
}: {
  userId: string;
  initialNotes: string;
}) {
  const { toast } = useToast();
  const [value, setValue] = useState(initialNotes);
  const [saved, setSaved] = useState<string>(initialNotes);
  const [pending, startTransition] = useTransition();

  const dirty = value !== saved;

  function save() {
    if (!dirty) return;
    const next = value.trim();
    startTransition(async () => {
      const res = await updateUserNotes({
        userId,
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
        <h2 className="text-[13px] font-semibold">Notes</h2>
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
        placeholder="Notes persist across every ticket this person is on. Never shown to clients."
        rows={6}
        className="w-full text-[13px] p-2.5 rounded-lg bg-[var(--background)] border border-[var(--color-neutral-300)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30 resize-none"
      />
      <p className="text-[10px] text-[var(--color-neutral-500)] mt-1.5">
        Only agents and admins can see this. Auto-saves on blur.
      </p>
    </div>
  );
}
