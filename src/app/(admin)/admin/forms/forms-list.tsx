"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { createTicketForm, updateTicketForm } from "@/actions/ticketForms";

type FormRow = {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  position: number;
  fieldCount: number;
  categoryCount: number;
};

export function FormsList({ forms }: { forms: FormRow[] }) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  function submit() {
    if (!name.trim()) return;
    startTransition(async () => {
      const r = await createTicketForm({
        name: name.trim(),
        description: description.trim() || null,
      });
      if (!r.ok) {
        toast({ title: "Couldn't create form", variant: "error" });
        return;
      }
      toast({ title: "Form created", description: name.trim(), variant: "success" });
      setName("");
      setDescription("");
      setCreating(false);
      router.push(`/admin/forms/${r.form.id}`);
    });
  }

  function toggle(f: FormRow) {
    startTransition(async () => {
      try {
        await updateTicketForm({ id: f.id, isActive: !f.isActive });
        toast({
          title: f.isActive ? "Form deactivated" : "Form reactivated",
          description: f.name,
          variant: "success",
        });
        router.refresh();
      } catch (e) {
        toast({
          title: "Couldn't update form",
          description: e instanceof Error ? e.message : undefined,
          variant: "error",
        });
      }
    });
  }

  return (
    <div className="max-w-3xl">
      <div className="bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="text-sm text-[var(--color-neutral-500)]">
            {forms.length} form{forms.length === 1 ? "" : "s"}
          </div>
          <Button size="sm" onClick={() => setCreating(true)}>
            Add form
          </Button>
        </div>
        {forms.length === 0 ? (
          <div className="text-center py-10 text-sm text-[var(--color-neutral-500)]">
            No ticket forms yet. Add one to route different categories through different
            intake fields.
          </div>
        ) : (
          <div className="space-y-2">
            {forms.map((f) => (
              <div
                key={f.id}
                className={`flex items-center gap-3 rounded-xl border border-[var(--color-neutral-200)] p-3 ${
                  f.isActive ? "" : "opacity-60"
                }`}
              >
                <div className="flex-1 min-w-0">
                  <Link
                    href={`/admin/forms/${f.id}`}
                    className="font-medium text-sm hover:underline"
                  >
                    {f.name}
                  </Link>
                  {f.description ? (
                    <div className="text-xs text-[var(--color-neutral-500)] mt-1">
                      {f.description}
                    </div>
                  ) : null}
                  <div className="text-[11px] text-[var(--color-neutral-500)] mt-1">
                    {f.fieldCount} field{f.fieldCount === 1 ? "" : "s"} · {f.categoryCount}{" "}
                    categor{f.categoryCount === 1 ? "y" : "ies"}
                  </div>
                </div>
                <Link
                  href={`/admin/forms/${f.id}`}
                  className="inline-flex items-center h-8 px-3.5 text-[13px] rounded-full text-[var(--foreground)] hover:bg-[var(--color-light-gray)] transition-colors"
                >
                  Edit
                </Link>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={pending}
                  onClick={() => toggle(f)}
                >
                  {f.isActive ? "Deactivate" : "Reactivate"}
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>

      <Modal open={creating} onClose={() => setCreating(false)} title="New ticket form">
        <div className="space-y-3">
          <label className="block">
            <div className="text-xs font-medium mb-1">Name</div>
            <Input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Hardware issue"
            />
          </label>
          <label className="block">
            <div className="text-xs font-medium mb-1">Description (optional)</div>
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Shown as help text to the client"
            />
          </label>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setCreating(false)}>
              Cancel
            </Button>
            <Button disabled={pending || !name.trim()} onClick={submit}>
              Create form
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
