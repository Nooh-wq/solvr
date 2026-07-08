"use client";

// Z4.2 — kebab menu on org detail. Delete is behind a typed-confirm
// (matches the M21 danger-zone pattern) — the user has to retype the
// org's exact name before the delete button becomes clickable.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteOrganizationAction } from "@/actions/organizations";
import { useToast } from "@/components/ui/toast";
import { Modal } from "@/components/ui/modal";

export function OrgActionsMenu({
  organizationId,
  organizationName,
}: {
  organizationId: string;
  organizationName: string;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [pending, startTransition] = useTransition();

  const typedMatches = typed.trim() === organizationName;

  function handleDelete() {
    if (!typedMatches) return;
    startTransition(async () => {
      const res = await deleteOrganizationAction(organizationId);
      if ("ok" in res && res.ok) {
        toast({ title: `Deleted ${organizationName}`, variant: "success" });
        router.push("/admin/organizations");
      } else {
        toast({
          title: "Delete failed",
          description: "error" in res ? res.error : undefined,
          variant: "error",
        });
      }
    });
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setMenuOpen((o) => !o)}
        onBlur={() => setTimeout(() => setMenuOpen(false), 120)}
        aria-label="Organization actions"
        className="h-8 w-8 rounded-lg border border-[var(--color-neutral-300)] cursor-pointer hover:bg-[var(--color-light-gray)] flex items-center justify-center"
      >
        <span aria-hidden className="text-lg leading-none">⋯</span>
      </button>
      {menuOpen && (
        <div className="absolute right-0 top-9 z-10 bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-lg shadow-lg py-1 min-w-[160px]">
          <button
            type="button"
            onMouseDown={(e) => {
              e.preventDefault();
              setMenuOpen(false);
              setConfirmOpen(true);
              setTyped("");
            }}
            className="w-full text-left px-3 py-1.5 text-[13px] text-red-600 dark:text-red-400 hover:bg-red-500/10 cursor-pointer"
          >
            Delete organization
          </button>
        </div>
      )}

      <Modal open={confirmOpen} onClose={() => setConfirmOpen(false)} title="Delete organization">
        <div className="space-y-3">
          <p className="text-[13px] text-[var(--color-neutral-700)]">
            This removes <span className="font-semibold">{organizationName}</span> from every ticket and unlinks all its users. This can&apos;t be undone.
          </p>
          <div>
            <label className="text-[11px] font-semibold text-[var(--color-neutral-600)] uppercase tracking-wide">
              Type the organization name to confirm
            </label>
            <input
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder={organizationName}
              className="mt-1 w-full h-9 px-3 text-sm border border-[var(--color-neutral-300)] rounded-lg bg-[var(--background)] focus:outline-none focus:ring-2 focus:ring-red-500/30"
            />
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => setConfirmOpen(false)}
              className="h-9 px-4 text-[13px] font-medium border border-[var(--color-neutral-300)] rounded-lg cursor-pointer hover:bg-[var(--color-light-gray)]"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleDelete}
              disabled={!typedMatches || pending}
              className="h-9 px-4 text-[13px] font-medium bg-red-600 text-white rounded-lg cursor-pointer hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {pending ? "Deleting…" : "Delete permanently"}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
