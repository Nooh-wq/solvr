"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import {
  createDefinition,
  updateDefinition,
  deactivateDefinition,
} from "@/actions/customFields";

type Scope = "USER" | "ORG" | "TICKET";
type FieldType = "TEXT" | "NUMBER" | "DATE" | "CHECKBOX";

type Definition = {
  id: string;
  scope: Scope;
  type: FieldType;
  key: string;
  label: string;
  description: string | null;
  isActive: boolean;
  isRequired: boolean;
  position: number;
};

const TYPE_LABEL: Record<FieldType, string> = {
  TEXT: "Text",
  NUMBER: "Number",
  DATE: "Date",
  CHECKBOX: "Checkbox",
};

const SCOPE_LABEL: Record<Scope, string> = {
  USER: "Users",
  ORG: "Organizations",
  TICKET: "Tickets",
};

const SCOPES: Scope[] = ["USER", "ORG", "TICKET"];

function Pill({
  children,
  tone = "default",
}: {
  children: React.ReactNode;
  tone?: "default" | "warning" | "muted";
}) {
  const cls =
    tone === "warning"
      ? "bg-[var(--color-orange-pale)] text-[var(--color-orange-deep)]"
      : tone === "muted"
        ? "bg-[var(--color-surface)] border border-[var(--color-neutral-300)] text-[var(--color-neutral-500)]"
        : "bg-[var(--color-neutral-100)] text-[var(--color-neutral-700)]";
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${cls}`}>
      {children}
    </span>
  );
}

export function FieldsManager({
  scope,
  definitions,
}: {
  scope: Scope;
  definitions: Definition[];
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Definition | null>(null);

  function toggleActive(def: Definition) {
    startTransition(async () => {
      try {
        if (def.isActive) {
          await deactivateDefinition(def.id);
          toast({ title: "Field deactivated", description: def.label, variant: "success" });
        } else {
          await updateDefinition({ id: def.id, isActive: true });
          toast({ title: "Field reactivated", description: def.label, variant: "success" });
        }
        router.refresh();
      } catch (e) {
        toast({
          title: "Couldn't update field",
          description: e instanceof Error ? e.message : undefined,
          variant: "error",
        });
      }
    });
  }

  return (
    <div className="max-w-3xl">
      <div className="flex items-center gap-2 mb-5 border-b border-[var(--color-neutral-200)]">
        {SCOPES.map((s) => (
          <Link
            key={s}
            href={`/admin/fields?scope=${s}`}
            className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              s === scope
                ? "border-[var(--color-primary)] text-[var(--foreground)]"
                : "border-transparent text-[var(--color-neutral-500)] hover:text-[var(--foreground)]"
            }`}
          >
            {SCOPE_LABEL[s]}
          </Link>
        ))}
      </div>

      <div className="bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <div className="text-sm font-semibold">{SCOPE_LABEL[scope]} fields</div>
            <div className="text-xs text-[var(--color-neutral-500)]">
              {definitions.length} field{definitions.length === 1 ? "" : "s"}
            </div>
          </div>
          <Button size="sm" onClick={() => setCreating(true)}>
            Add field
          </Button>
        </div>

        {definitions.length === 0 ? (
          <div className="text-center py-10 text-sm text-[var(--color-neutral-500)]">
            No fields yet. Add one to start collecting structured data on{" "}
            {SCOPE_LABEL[scope].toLowerCase()}.
          </div>
        ) : (
          <div className="space-y-2">
            {definitions.map((d) => (
              <div
                key={d.id}
                className={`flex items-center gap-3 rounded-xl border border-[var(--color-neutral-200)] p-3 ${
                  d.isActive ? "" : "opacity-60"
                }`}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-sm">{d.label}</span>
                    <code className="text-[11px] px-1.5 py-0.5 rounded bg-[var(--color-neutral-100)] text-[var(--color-neutral-600)]">
                      {d.key}
                    </code>
                    <Pill>{TYPE_LABEL[d.type]}</Pill>
                    {d.isRequired ? <Pill tone="warning">Required</Pill> : null}
                    {!d.isActive ? <Pill tone="muted">Inactive</Pill> : null}
                  </div>
                  {d.description ? (
                    <div className="text-xs text-[var(--color-neutral-500)] mt-1">{d.description}</div>
                  ) : null}
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={pending}
                  onClick={() => setEditing(d)}
                >
                  Edit
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={pending}
                  onClick={() => toggleActive(d)}
                >
                  {d.isActive ? "Deactivate" : "Reactivate"}
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>

      <CreateFieldModal
        open={creating}
        scope={scope}
        onClose={() => setCreating(false)}
        onCreated={() => {
          setCreating(false);
          router.refresh();
        }}
      />

      <EditFieldModal
        definition={editing}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          router.refresh();
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Create modal
// ---------------------------------------------------------------------------

function CreateFieldModal({
  open,
  scope,
  onClose,
  onCreated,
}: {
  open: boolean;
  scope: Scope;
  onClose: () => void;
  onCreated: () => void;
}) {
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [key, setKey] = useState("");
  const [label, setLabel] = useState("");
  const [description, setDescription] = useState("");
  const [type, setType] = useState<FieldType>("TEXT");
  const [isRequired, setIsRequired] = useState(false);

  function reset() {
    setKey("");
    setLabel("");
    setDescription("");
    setType("TEXT");
    setIsRequired(false);
  }

  function submit() {
    if (!key.trim() || !label.trim()) return;
    startTransition(async () => {
      try {
        const r = await createDefinition({
          scope,
          type,
          key: key.trim(),
          label: label.trim(),
          description: description.trim() || null,
          isRequired,
        });
        if (!r.ok) {
          toast({ title: "Couldn't create field", description: r.error, variant: "error" });
          return;
        }
        toast({ title: "Field created", description: label.trim(), variant: "success" });
        reset();
        onCreated();
      } catch (e) {
        toast({
          title: "Couldn't create field",
          description: e instanceof Error ? e.message : undefined,
          variant: "error",
        });
      }
    });
  }

  return (
    <Modal
      open={open}
      onClose={() => {
        reset();
        onClose();
      }}
      title={`New ${SCOPE_LABEL[scope].toLowerCase().replace(/s$/, "")} field`}
    >
      <div className="space-y-3">
        <label className="block">
          <div className="text-xs font-medium mb-1">Label</div>
          <Input
            autoFocus
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Service tier"
          />
        </label>
        <label className="block">
          <div className="text-xs font-medium mb-1">
            Key <span className="text-[var(--color-neutral-500)] font-normal">(immutable)</span>
          </div>
          <Input
            value={key}
            onChange={(e) => setKey(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_"))}
            placeholder="service_tier"
          />
          <div className="text-[11px] text-[var(--color-neutral-500)] mt-1">
            Lowercase snake_case, starts with a letter. Used in placeholders and integrations —
            can&apos;t be changed later.
          </div>
        </label>
        <label className="block">
          <div className="text-xs font-medium mb-1">Type</div>
          <select
            value={type}
            onChange={(e) => setType(e.target.value as FieldType)}
            className="w-full h-9 rounded-lg border border-[var(--color-neutral-300)] bg-[var(--color-surface)] px-3 text-sm"
          >
            <option value="TEXT">Text</option>
            <option value="NUMBER">Number</option>
            <option value="DATE">Date</option>
            <option value="CHECKBOX">Checkbox</option>
          </select>
        </label>
        <label className="block">
          <div className="text-xs font-medium mb-1">Description (optional)</div>
          <Input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Shown as help text on the sidebar"
          />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={isRequired}
            onChange={(e) => setIsRequired(e.target.checked)}
          />
          Required
        </label>
        <div className="flex justify-end gap-2 pt-2">
          <Button
            variant="secondary"
            onClick={() => {
              reset();
              onClose();
            }}
          >
            Cancel
          </Button>
          <Button disabled={pending || !key.trim() || !label.trim()} onClick={submit}>
            Create field
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Edit modal — label/description/isRequired/position only. Key is immutable.
// ---------------------------------------------------------------------------

function EditFieldModal({
  definition,
  onClose,
  onSaved,
}: {
  definition: Definition | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [label, setLabel] = useState("");
  const [description, setDescription] = useState("");
  const [isRequired, setIsRequired] = useState(false);

  // Re-sync form state when the selected definition changes (opening a
  // different row). Keyed on id so re-renders with the same row don't clobber
  // in-flight edits.
  useEffect(() => {
    if (definition) {
      setLabel(definition.label);
      setDescription(definition.description ?? "");
      setIsRequired(definition.isRequired);
    }
  }, [definition?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  function submit() {
    if (!definition) return;
    startTransition(async () => {
      try {
        await updateDefinition({
          id: definition.id,
          label: label.trim() || undefined,
          description: description.trim() ? description.trim() : null,
          isRequired,
        });
        toast({ title: "Field updated", variant: "success" });
        onSaved();
      } catch (e) {
        toast({
          title: "Couldn't save field",
          description: e instanceof Error ? e.message : undefined,
          variant: "error",
        });
      }
    });
  }

  return (
    <Modal open={definition !== null} onClose={onClose} title="Edit field">
      {definition ? (
        <div className="space-y-3">
          <div className="rounded-lg bg-[var(--color-neutral-100)] px-3 py-2 text-xs">
            <div>
              Key: <code>{definition.key}</code>
            </div>
            <div>Type: {TYPE_LABEL[definition.type]}</div>
          </div>
          <label className="block">
            <div className="text-xs font-medium mb-1">Label</div>
            <Input value={label} onChange={(e) => setLabel(e.target.value)} />
          </label>
          <label className="block">
            <div className="text-xs font-medium mb-1">Description</div>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={isRequired}
              onChange={(e) => setIsRequired(e.target.checked)}
            />
            Required
          </label>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button disabled={pending} onClick={submit}>
              Save
            </Button>
          </div>
        </div>
      ) : null}
    </Modal>
  );
}
