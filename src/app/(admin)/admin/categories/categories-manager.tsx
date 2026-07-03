"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { upsertCategory } from "@/actions/admin";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Category = { id: string; name: string; isActive: boolean };

export function CategoriesManager({ categories }: { categories: Category[] }) {
  const router = useRouter();
  const [newName, setNewName] = useState("");
  const [pending, startTransition] = useTransition();

  function toggle(cat: Category) {
    startTransition(async () => {
      await upsertCategory({ id: cat.id, name: cat.name, isActive: !cat.isActive });
      router.refresh();
    });
  }

  function rename(cat: Category, name: string) {
    startTransition(async () => {
      await upsertCategory({ id: cat.id, name, isActive: cat.isActive });
      router.refresh();
    });
  }

  function addCategory() {
    if (!newName.trim()) return;
    startTransition(async () => {
      await upsertCategory({ name: newName.trim(), isActive: true });
      setNewName("");
      router.refresh();
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
