"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { upsertCategory } from "@/actions/admin";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";

type Category = { id: string; name: string; isActive: boolean };

export function CategoriesManager({ categories }: { categories: Category[] }) {
  const router = useRouter();
  const { toast } = useToast();
  const [newName, setNewName] = useState("");
  const [pending, startTransition] = useTransition();

  function toggle(cat: Category) {
    startTransition(async () => {
      try {
        const result = await upsertCategory({ id: cat.id, name: cat.name, isActive: !cat.isActive });
        if (!result.ok) {
          toast({ title: "Couldn't update category", description: result.error, variant: "error" });
          return;
        }
        toast({ title: cat.isActive ? "Category disabled" : "Category enabled", description: cat.name, variant: "success" });
        router.refresh();
      } catch (e) {
        toast({ title: "Couldn't update category", description: e instanceof Error ? e.message : undefined, variant: "error" });
      }
    });
  }

  function rename(cat: Category, name: string) {
    startTransition(async () => {
      try {
        const result = await upsertCategory({ id: cat.id, name, isActive: cat.isActive });
        if (!result.ok) {
          toast({ title: "Couldn't rename category", description: result.error, variant: "error" });
          router.refresh(); // revert the input to the last-saved name
          return;
        }
        toast({ title: "Category renamed", variant: "success" });
        router.refresh();
      } catch (e) {
        toast({ title: "Couldn't rename category", description: e instanceof Error ? e.message : undefined, variant: "error" });
      }
    });
  }

  function addCategory() {
    if (!newName.trim()) return;
    const name = newName.trim();
    startTransition(async () => {
      try {
        const result = await upsertCategory({ name, isActive: true });
        if (!result.ok) {
          toast({ title: "Couldn't add category", description: result.error, variant: "error" });
          return;
        }
        setNewName("");
        toast({ title: "Category added", description: name, variant: "success" });
        router.refresh();
      } catch (e) {
        toast({ title: "Couldn't add category", description: e instanceof Error ? e.message : undefined, variant: "error" });
      }
    });
  }

  return (
    <div className="max-w-xl bg-white border border-[var(--color-neutral-300)] rounded p-5">
      <div className="space-y-3 mb-4">
        {categories.map((c) => (
          <div key={c.id} className="flex items-center gap-3">
            <Input
              defaultValue={c.name}
              className="flex-1"
              onBlur={(e) => e.target.value !== c.name && rename(c, e.target.value)}
            />
            <Button variant="secondary" size="sm" disabled={pending} onClick={() => toggle(c)}>
              {c.isActive ? "Disable" : "Enable"}
            </Button>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-3 pt-3 border-t border-[var(--color-neutral-100)]">
        <Input placeholder="New category" value={newName} onChange={(e) => setNewName(e.target.value)} className="flex-1" />
        <Button size="sm" disabled={pending || !newName.trim()} onClick={addCategory}>
          Add
        </Button>
      </div>
    </div>
  );
}
