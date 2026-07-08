"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createGroupAction } from "@/actions/groups";
import { useToast } from "@/components/ui/toast";
import { Modal } from "@/components/ui/modal";
import { PlusIcon } from "@/components/icons";

export function CreateGroupButton() {
  const router = useRouter();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [pending, startTransition] = useTransition();

  function submit() {
    if (name.trim() === "") return;
    startTransition(async () => {
      const res = await createGroupAction({ name: name.trim() });
      if ("ok" in res && res.ok) {
        setOpen(false);
        setName("");
        router.push(`/admin/groups/${res.id}`);
      } else {
        toast({
          title: "Couldn't create",
          description: "error" in res ? res.error : undefined,
          variant: "error",
        });
      }
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="h-9 px-3 text-[13px] font-medium bg-[var(--color-primary)] text-white rounded-lg cursor-pointer hover:opacity-90 inline-flex items-center gap-1.5"
      >
        <PlusIcon className="h-4 w-4" /> New group
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="Create group">
        <div className="space-y-3">
          <div>
            <label className="text-[11px] font-semibold text-[var(--color-neutral-600)] uppercase tracking-wide">
              Name
            </label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Northwind Team"
              autoFocus
              className="mt-1 w-full h-9 px-3 text-sm border border-[var(--color-neutral-300)] rounded-lg bg-[var(--background)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30"
            />
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={submit}
              disabled={pending || name.trim() === ""}
              className="h-9 px-4 text-[13px] font-medium bg-[var(--color-primary)] text-white rounded-lg cursor-pointer hover:opacity-90 disabled:opacity-50"
            >
              {pending ? "Creating…" : "Create"}
            </button>
          </div>
        </div>
      </Modal>
    </>
  );
}
