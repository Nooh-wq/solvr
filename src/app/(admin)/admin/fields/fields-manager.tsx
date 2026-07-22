"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import {
  createDefinition,
  updateDefinition,
  deactivateDefinition,
  listOptions,
  upsertOption,
  deleteOption,
} from "@/actions/customFields";

type Scope = "USER" | "ORG" | "TICKET";
type FieldType =
  | "TEXT"
  | "NUMBER"
  | "DATE"
  | "CHECKBOX"
  | "DROPDOWN"
  | "MULTISELECT"
  | "USER_LOOKUP"
  | "ORG_LOOKUP";

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
  optionCount: number;
};

type OptionRow = {
  id: string;
  value: string;
  label: string;
  position: number;
  implicitTag: string | null;
};

const TYPE_LABEL: Record<FieldType, string> = {
  TEXT: "Text",
  NUMBER: "Number",
  DATE: "Date",
  CHECKBOX: "Checkbox",
  DROPDOWN: "Dropdown",
  MULTISELECT: "Multiselect",
  USER_LOOKUP: "User lookup",
  ORG_LOOKUP: "Organization lookup",
};

const SCOPE_LABEL: Record<Scope, string> = {
  USER: "Users",
  ORG: "Organizations",
  TICKET: "Tickets",
};

const SCOPES: Scope[] = ["USER", "ORG", "TICKET"];

function isOptionType(t: FieldType): boolean {
  return t === "DROPDOWN" || t === "MULTISELECT";
}

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
  const [managingOptionsFor, setManagingOptionsFor] = useState<Definition | null>(null);

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
                    {isOptionType(d.type) ? (
                      <Pill tone="muted">
                        {d.optionCount} option{d.optionCount === 1 ? "" : "s"}
                      </Pill>
                    ) : null}
                    {d.isRequired ? <Pill tone="warning">Required</Pill> : null}
                    {!d.isActive ? <Pill tone="muted">Inactive</Pill> : null}
                  </div>
                  {d.description ? (
                    <div className="text-xs text-[var(--color-neutral-500)] mt-1">{d.description}</div>
                  ) : null}
                </div>
                {isOptionType(d.type) ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={pending}
                    onClick={() => setManagingOptionsFor(d)}
                  >
                    Options
                  </Button>
                ) : null}
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
        key={editing?.id ?? "edit-closed"}
        definition={editing}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          router.refresh();
        }}
      />

      <OptionsModal
        key={managingOptionsFor?.id ?? "options-closed"}
        definition={managingOptionsFor}
        onClose={() => {
          setManagingOptionsFor(null);
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
        toast({
          title: "Field created",
          description: isOptionType(type)
            ? `${label.trim()} — add options next`
            : label.trim(),
          variant: "success",
        });
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
          <Select
            value={type}
            onChange={(e) => setType(e.target.value as FieldType)}
            className="h-9"
          >
            <option value="TEXT">Text</option>
            <option value="NUMBER">Number</option>
            <option value="DATE">Date</option>
            <option value="CHECKBOX">Checkbox</option>
            <option value="DROPDOWN">Dropdown</option>
            <option value="MULTISELECT">Multiselect</option>
            <option value="USER_LOOKUP">User lookup</option>
            <option value="ORG_LOOKUP">Organization lookup</option>
          </Select>
          {isOptionType(type) ? (
            <div className="text-[11px] text-[var(--color-neutral-500)] mt-1">
              You&apos;ll add the option list after creating the field.
            </div>
          ) : null}
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
// Edit modal
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
  // The caller keys this component by definition id, so a change of
  // definition remounts and re-runs these initializers — no prop-sync
  // effect needed.
  const [label, setLabel] = useState(definition?.label ?? "");
  const [description, setDescription] = useState(definition?.description ?? "");
  const [isRequired, setIsRequired] = useState(definition?.isRequired ?? false);

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

// ---------------------------------------------------------------------------
// Options modal (Z2.2)
// ---------------------------------------------------------------------------

function OptionsModal({
  definition,
  onClose,
}: {
  definition: Definition | null;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [options, setOptions] = useState<OptionRow[]>([]);
  const [newValue, setNewValue] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [newTag, setNewTag] = useState("");
  // Keyed by definition id at the call site, so "loading" starts true
  // whenever the modal opens for a definition and the effect only does
  // the async fetch (no synchronous setState).
  const [loading, setLoading] = useState(definition !== null);

  useEffect(() => {
    if (!definition) return;
    listOptions(definition.id)
      .then((rows) =>
        setOptions(
          rows.map((r) => ({
            id: r.id,
            value: r.value,
            label: r.label,
            position: r.position,
            implicitTag: r.implicitTag,
          }))
        )
      )
      .catch((e) => toast({ title: "Couldn't load options", description: e?.message, variant: "error" }))
      .finally(() => setLoading(false));
  }, [definition?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  function refresh() {
    if (!definition) return;
    listOptions(definition.id).then((rows) =>
      setOptions(
        rows.map((r) => ({
          id: r.id,
          value: r.value,
          label: r.label,
          position: r.position,
          implicitTag: r.implicitTag,
        }))
      )
    );
  }

  function addOption() {
    if (!definition || !newValue.trim() || !newLabel.trim()) return;
    startTransition(async () => {
      const r = await upsertOption({
        fieldDefinitionId: definition.id,
        value: newValue.trim(),
        label: newLabel.trim(),
        position: options.length,
        implicitTag: newTag.trim() || null,
      });
      if (!r.ok) {
        toast({ title: "Couldn't add option", description: r.error, variant: "error" });
        return;
      }
      setNewValue("");
      setNewLabel("");
      setNewTag("");
      toast({ title: "Option added", variant: "success" });
      refresh();
    });
  }

  function saveOption(opt: OptionRow) {
    if (!definition) return;
    startTransition(async () => {
      const r = await upsertOption({
        fieldDefinitionId: definition.id,
        id: opt.id,
        value: opt.value,
        label: opt.label,
        position: opt.position,
        implicitTag: opt.implicitTag,
      });
      if (!r.ok) {
        toast({ title: "Couldn't save option", description: r.error, variant: "error" });
        return;
      }
      toast({ title: "Option saved", variant: "success" });
      refresh();
    });
  }

  function removeOption(opt: OptionRow) {
    startTransition(async () => {
      try {
        await deleteOption(opt.id);
        toast({ title: "Option deleted", description: opt.label, variant: "success" });
        refresh();
      } catch (e) {
        toast({
          title: "Couldn't delete option",
          description: e instanceof Error ? e.message : undefined,
          variant: "error",
        });
      }
    });
  }

  return (
    <Modal
      open={definition !== null}
      onClose={onClose}
      title={definition ? `Options — ${definition.label}` : "Options"}
      widthClass="max-w-lg"
    >
      {definition ? (
        <div className="space-y-4">
          <div className="text-xs text-[var(--color-neutral-500)]">
            <code>{definition.key}</code> — {TYPE_LABEL[definition.type]}. Values are immutable
            after create. Implicit tags are applied by triggers when the option is picked
            (available Z8+).
          </div>

          {loading ? (
            <div className="text-sm text-[var(--color-neutral-500)]">Loading…</div>
          ) : options.length === 0 ? (
            <div className="text-sm text-[var(--color-neutral-500)]">No options yet.</div>
          ) : (
            <div className="space-y-2">
              {options.map((o, idx) => (
                <div
                  key={o.id}
                  className="rounded-lg border border-[var(--color-neutral-200)] p-3 space-y-2"
                >
                  <div className="flex items-center gap-2">
                    <code className="text-[11px] px-1.5 py-0.5 rounded bg-[var(--color-neutral-100)] text-[var(--color-neutral-600)]">
                      {o.value}
                    </code>
                    <Input
                      value={o.label}
                      onChange={(e) => {
                        const next = [...options];
                        next[idx] = { ...o, label: e.target.value };
                        setOptions(next);
                      }}
                      onBlur={() => saveOption(o)}
                      className="flex-1"
                    />
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => removeOption(o)}
                      disabled={pending}
                    >
                      Delete
                    </Button>
                  </div>
                  <Input
                    placeholder="Implicit tag (optional)"
                    value={o.implicitTag ?? ""}
                    onChange={(e) => {
                      const next = [...options];
                      next[idx] = { ...o, implicitTag: e.target.value || null };
                      setOptions(next);
                    }}
                    onBlur={() => saveOption(o)}
                  />
                </div>
              ))}
            </div>
          )}

          <div className="pt-3 border-t border-[var(--color-neutral-200)]">
            <div className="text-xs font-medium mb-2">Add option</div>
            <div className="grid grid-cols-2 gap-2">
              <Input
                placeholder="Value (immutable)"
                value={newValue}
                onChange={(e) =>
                  setNewValue(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, "_"))
                }
              />
              <Input
                placeholder="Label"
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
              />
            </div>
            <Input
              placeholder="Implicit tag (optional)"
              value={newTag}
              onChange={(e) => setNewTag(e.target.value)}
              className="mt-2"
            />
            <div className="flex justify-end gap-2 mt-3">
              <Button
                size="sm"
                disabled={pending || !newValue.trim() || !newLabel.trim()}
                onClick={addOption}
              >
                Add
              </Button>
            </div>
          </div>

          <div className="flex justify-end pt-2 border-t border-[var(--color-neutral-200)]">
            <Button variant="secondary" onClick={onClose}>
              Done
            </Button>
          </div>
        </div>
      ) : null}
    </Modal>
  );
}
