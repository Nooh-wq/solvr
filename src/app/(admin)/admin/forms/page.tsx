import Link from "next/link";
import { listTicketForms } from "@/actions/ticketForms";
import { FormsList } from "./forms-list";

// Z2.3 — Ticket Forms admin. This page is the list; each row links to
// /admin/forms/[id] for the editor.

export default async function FormsPage() {
  const forms = await listTicketForms();
  return (
    <div>
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold mb-1">Ticket forms</h1>
          <p className="text-sm text-[var(--color-neutral-500)]">
            Different intake paths for different ticket categories. Each form curates a subset
            of your ticket custom fields.
          </p>
        </div>
      </div>
      <FormsList
        forms={forms.map((f) => ({
          id: f.id,
          name: f.name,
          description: f.description,
          isActive: f.isActive,
          position: f.position,
          fieldCount: f._count.fields,
          categoryCount: f._count.categories,
        }))}
      />
    </div>
  );
}
