import Link from "next/link";
import { notFound } from "next/navigation";
import { getTicketFormFull } from "@/actions/ticketForms";
import { listDefinitions } from "@/actions/customFields";
import { listAllCategories } from "@/actions/admin";
import { FormEditor } from "./form-editor";

export default async function FormEditorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [form, defs, categories] = await Promise.all([
    getTicketFormFull(id),
    listDefinitions("TICKET"),
    listAllCategories(),
  ]);
  if (!form) notFound();

  return (
    <div>
      <div className="mb-4 text-sm text-[var(--color-neutral-500)]">
        <Link href="/admin/forms" className="hover:underline">
          Ticket forms
        </Link>{" "}
        / {form.name}
      </div>
      <FormEditor
        form={{
          id: form.id,
          name: form.name,
          description: form.description,
          isActive: form.isActive,
          fields: form.fields.map((f) => ({
            id: f.id,
            position: f.position,
            isRequiredOverride: f.isRequiredOverride,
            visibleWhenFieldId: f.visibleWhenFieldId,
            visibleWhenValue: f.visibleWhenValue,
            definition: {
              id: f.fieldDefinition.id,
              key: f.fieldDefinition.key,
              label: f.fieldDefinition.label,
              type: f.fieldDefinition.type,
              isRequired: f.fieldDefinition.isRequired,
              options: f.fieldDefinition.options,
            },
          })),
          categoryIds: form.categories.map((c) => c.categoryId),
        }}
        allTicketDefs={defs
          .filter((d) => d.isActive)
          .map((d) => ({
            id: d.id,
            key: d.key,
            label: d.label,
            type: d.type,
          }))}
        allCategories={categories
          .filter((c) => c.isActive)
          .map((c) => ({ id: c.id, name: c.name }))}
      />
    </div>
  );
}
