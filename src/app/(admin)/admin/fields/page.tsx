import { listDefinitions } from "@/actions/customFields";
import { FieldsManager } from "./fields-manager";

// Z2.1 — Custom Fields admin. Three scopes rendered as tabs; each tab is a
// list of definitions with add/edit/deactivate. Value editing on individual
// user/org/ticket sidebars ships in Z2.1's next task.

export default async function FieldsPage({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string }>;
}) {
  const params = await searchParams;
  const scope = (params?.scope === "ORG" || params?.scope === "TICKET" ? params.scope : "USER") as
    | "USER"
    | "ORG"
    | "TICKET";
  const definitions = await listDefinitions(scope);
  return (
    <div>
      <h1 className="text-2xl font-bold mb-1">Custom fields</h1>
      <p className="text-sm text-[var(--color-neutral-500)] mb-6">
        Typed fields you can attach to users, organizations, and tickets. Keys
        are immutable after creation — labels can be renamed freely.
      </p>
      <FieldsManager
        scope={scope}
        definitions={definitions.map((d) => ({
          id: d.id,
          scope: d.scope,
          type: d.type,
          key: d.key,
          label: d.label,
          description: d.description,
          isActive: d.isActive,
          isRequired: d.isRequired,
          position: d.position,
        }))}
      />
    </div>
  );
}
