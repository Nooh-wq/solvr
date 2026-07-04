"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createTicket } from "@/actions/tickets";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea, Select } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";

export function NewTicketForm({ categories }: { categories: { id: string; name: string }[] }) {
  const router = useRouter();
  const { toast } = useToast();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const result = await createTicket({
        title: String(formData.get("title")),
        description: String(formData.get("description")),
        categoryId: String(formData.get("categoryId") || "") || undefined,
        priority: formData.get("priority") as "LOW" | "MEDIUM" | "HIGH" | "URGENT",
      });
      if ("error" in result && result.error) {
        setError(result.error as string);
        toast({ title: "Couldn't create ticket", description: result.error as string, variant: "error" });
        return;
      }
      toast({ title: "Ticket created", description: "We'll follow up soon.", variant: "success" });
      router.push("/portal");
    });
  }

  return (
    <form action={onSubmit} className="space-y-4 bg-white border border-[var(--color-neutral-300)] rounded-2xl p-6">
      <div className="space-y-1.5">
        <Label htmlFor="title">Title</Label>
        <Input id="title" name="title" required minLength={3} placeholder="Short summary of the issue" />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="description">Description</Label>
        <Textarea id="description" name="description" required rows={6} placeholder="What's happening? Include steps to reproduce if relevant." />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="categoryId">Category</Label>
          <Select id="categoryId" name="categoryId" defaultValue="">
            <option value="">Select a category</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="priority">Priority</Label>
          <Select id="priority" name="priority" defaultValue="MEDIUM">
            <option value="LOW">Low</option>
            <option value="MEDIUM">Medium</option>
            <option value="HIGH">High</option>
            <option value="URGENT">Urgent</option>
          </Select>
        </div>
      </div>
      {/* TODO(decision): attachment upload to Supabase Storage (≤25MB, allowlisted mime) — wire in M2.5 */}
      {error && <p className="text-[13px] text-red-600">{error}</p>}
      <Button type="submit" disabled={pending}>
        {pending ? "Submitting…" : "Submit ticket"}
      </Button>
    </form>
  );
}
