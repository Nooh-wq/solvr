"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  upsertAiTool,
  deleteAiTool,
  seedBuiltinTools,
  type ToolDto,
} from "@/actions/aiTools";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";

const CALLER_ROLES = ["CLIENT", "GUEST", "AGENT", "ADMIN", "SUPER_ADMIN"] as const;

type Editing = ToolDto | { create: true } | null;

const EMPTY_TOOL: ToolDto = {
  id: "",
  name: "",
  description: "",
  kind: "INTERNAL",
  argsSchemaJson: JSON.stringify({ type: "object", properties: {}, required: [] }, null, 2),
  requiresApproval: true,
  isEnabled: true,
  roleAllowlist: [],
  httpUrl: null,
  httpMethod: null,
  httpHeadersJson: null,
  retryLimit: 2,
  updatedAt: "",
  isBuiltin: false,
};

export function ToolsForm({ tools }: { tools: ToolDto[] }) {
  const router = useRouter();
  const { toast } = useToast();
  const [editing, setEditing] = useState<Editing>(null);
  const [pending, startTransition] = useTransition();

  function seed() {
    startTransition(async () => {
      try {
        const { created } = await seedBuiltinTools();
        toast({ title: `Seeded ${created} built-in tools`, variant: "success" });
        router.refresh();
      } catch (e) {
        toast({
          title: "Seed failed",
          description: e instanceof Error ? e.message : undefined,
          variant: "error",
        });
      }
    });
  }

  function remove(id: string, name: string) {
    startTransition(async () => {
      try {
        await deleteAiTool(id);
        toast({ title: "Tool deleted", description: name, variant: "success" });
        router.refresh();
      } catch (e) {
        toast({
          title: "Couldn't delete tool",
          description: e instanceof Error ? e.message : undefined,
          variant: "error",
        });
      }
    });
  }

  if (editing) {
    const initial = "create" in editing ? EMPTY_TOOL : editing;
    return (
      <Editor
        initial={initial}
        isNew={"create" in editing}
        pending={pending}
        onCancel={() => setEditing(null)}
        onSave={(values) => {
          startTransition(async () => {
            try {
              await upsertAiTool(values);
              toast({
                title: "create" in editing ? "Tool created" : "Tool updated",
                description: values.name,
                variant: "success",
              });
              setEditing(null);
              router.refresh();
            } catch (e) {
              toast({
                title: "Couldn't save tool",
                description: e instanceof Error ? e.message : undefined,
                variant: "error",
              });
            }
          });
        }}
      />
    );
  }

  return (
    <div>
      <div className="flex justify-end gap-2 mb-4">
        <Button variant="secondary" size="sm" onClick={seed} disabled={pending}>
          Seed built-ins
        </Button>
        <Button size="sm" onClick={() => setEditing({ create: true })}>
          New tool
        </Button>
      </div>
      <div className="bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl overflow-hidden">
        {tools.length === 0 ? (
          <p className="p-8 text-center text-sm text-[var(--color-neutral-600)]">
            No tools registered. Click &quot;Seed built-ins&quot; to install the safe starter set.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-[var(--color-light-gray)] text-[11px] uppercase-label text-[var(--color-neutral-700)]">
              <tr>
                <th className="text-left font-semibold px-4 py-2.5">Name</th>
                <th className="text-left font-semibold px-4 py-2.5">Kind</th>
                <th className="text-left font-semibold px-4 py-2.5">Approval</th>
                <th className="text-left font-semibold px-4 py-2.5">Enabled</th>
                <th className="text-left font-semibold px-4 py-2.5">Allow-list</th>
                <th className="text-left font-semibold px-4 py-2.5"></th>
              </tr>
            </thead>
            <tbody>
              {tools.map((t) => (
                <tr key={t.id} className="border-t border-[var(--color-neutral-100)]">
                  <td className="px-4 py-3">
                    <button
                      onClick={() => setEditing(t)}
                      className="text-left text-[var(--color-primary)] font-medium"
                    >
                      {t.name}
                    </button>
                    {t.isBuiltin ? (
                      <span className="ml-2 text-[10px] uppercase-label text-[var(--color-neutral-500)]">
                        built-in
                      </span>
                    ) : null}
                    <div className="text-[12px] text-[var(--color-neutral-600)]">{t.description}</div>
                  </td>
                  <td className="px-4 py-3">{t.kind}</td>
                  <td className="px-4 py-3">{t.requiresApproval ? "Required" : "Auto"}</td>
                  <td className="px-4 py-3">{t.isEnabled ? "On" : "Off"}</td>
                  <td className="px-4 py-3 text-[12px] text-[var(--color-neutral-700)]">
                    {t.roleAllowlist.join(", ") || "—"}
                  </td>
                  <td className="px-4 py-3">
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={pending}
                      onClick={() => remove(t.id, t.name)}
                    >
                      Delete
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function Editor({
  initial,
  isNew,
  pending,
  onCancel,
  onSave,
}: {
  initial: ToolDto;
  isNew: boolean;
  pending: boolean;
  onCancel: () => void;
  onSave: (values: {
    id?: string;
    name: string;
    description: string;
    kind: "INTERNAL" | "HTTP";
    argsSchemaJson: string;
    requiresApproval: boolean;
    isEnabled: boolean;
    roleAllowlist: Array<(typeof CALLER_ROLES)[number]>;
    httpUrl?: string | null;
    httpMethod?: "GET" | "POST" | "PATCH" | "DELETE" | null;
    httpHeadersJson?: string | null;
    retryLimit: number;
  }) => void;
}) {
  const [name, setName] = useState(initial.name);
  const [description, setDescription] = useState(initial.description);
  const [kind, setKind] = useState<"INTERNAL" | "HTTP">(initial.kind as "INTERNAL" | "HTTP");
  const [argsSchemaJson, setArgsSchemaJson] = useState(initial.argsSchemaJson);
  const [requiresApproval, setRequiresApproval] = useState(initial.requiresApproval);
  const [isEnabled, setIsEnabled] = useState(initial.isEnabled);
  const [allowlist, setAllowlist] = useState<Set<string>>(new Set(initial.roleAllowlist));
  const [httpUrl, setHttpUrl] = useState(initial.httpUrl ?? "");
  const [httpMethod, setHttpMethod] = useState<"GET" | "POST" | "PATCH" | "DELETE">(
    (initial.httpMethod as "GET" | "POST" | "PATCH" | "DELETE") ?? "POST"
  );
  const [httpHeadersJson, setHttpHeadersJson] = useState(initial.httpHeadersJson ?? "");
  const [retryLimit, setRetryLimit] = useState(initial.retryLimit);

  function toggleRole(role: string) {
    const next = new Set(allowlist);
    if (next.has(role)) next.delete(role);
    else next.add(role);
    setAllowlist(next);
  }

  return (
    <div className="bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl p-5 max-w-3xl space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label htmlFor="toolName">Name (snake_case)</Label>
          <Input
            id="toolName"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={!isNew && initial.isBuiltin}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="toolKind">Kind</Label>
          <select
            id="toolKind"
            value={kind}
            onChange={(e) => setKind(e.target.value as "INTERNAL" | "HTTP")}
            className="h-10 w-full rounded-md border border-[var(--color-neutral-300)] bg-[var(--color-surface)] px-3 text-sm"
          >
            <option value="INTERNAL">Internal (built-in handler)</option>
            <option value="HTTP">HTTP (tenant API endpoint)</option>
          </select>
        </div>
      </div>

      <div className="space-y-1">
        <Label htmlFor="toolDesc">Description (shown to the AI)</Label>
        <Textarea
          id="toolDesc"
          rows={2}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>

      <div className="space-y-1">
        <Label htmlFor="toolSchema">Arguments schema (JSON)</Label>
        <Textarea
          id="toolSchema"
          rows={8}
          value={argsSchemaJson}
          onChange={(e) => setArgsSchemaJson(e.target.value)}
          className="font-mono text-[12px]"
        />
      </div>

      <div className="grid grid-cols-3 gap-3">
        <label className="flex items-center gap-2 text-[13px]">
          <input
            type="checkbox"
            checked={requiresApproval}
            onChange={(e) => setRequiresApproval(e.target.checked)}
          />
          Requires approval
        </label>
        <label className="flex items-center gap-2 text-[13px]">
          <input
            type="checkbox"
            checked={isEnabled}
            onChange={(e) => setIsEnabled(e.target.checked)}
          />
          Enabled
        </label>
        <div className="space-y-1">
          <Label htmlFor="toolRetry">Retry limit</Label>
          <Input
            id="toolRetry"
            type="number"
            min={0}
            max={5}
            value={retryLimit}
            onChange={(e) => setRetryLimit(Number(e.target.value))}
          />
        </div>
      </div>

      <div className="space-y-1">
        <div className="text-[12px] uppercase-label text-[var(--color-neutral-700)]">Role allow-list</div>
        <div className="flex flex-wrap gap-3">
          {CALLER_ROLES.map((r) => (
            <label key={r} className="flex items-center gap-2 text-[13px]">
              <input
                type="checkbox"
                checked={allowlist.has(r)}
                onChange={() => toggleRole(r)}
              />
              {r}
            </label>
          ))}
        </div>
      </div>

      {kind === "HTTP" ? (
        <div className="space-y-3 border-t border-[var(--color-neutral-200)] pt-4">
          <div className="grid grid-cols-4 gap-3">
            <div className="col-span-3 space-y-1">
              <Label htmlFor="httpUrl">HTTP URL</Label>
              <Input id="httpUrl" value={httpUrl} onChange={(e) => setHttpUrl(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="httpMethod">Method</Label>
              <select
                id="httpMethod"
                value={httpMethod}
                onChange={(e) => setHttpMethod(e.target.value as "GET" | "POST" | "PATCH" | "DELETE")}
                className="h-10 w-full rounded-md border border-[var(--color-neutral-300)] bg-[var(--color-surface)] px-3 text-sm"
              >
                <option value="GET">GET</option>
                <option value="POST">POST</option>
                <option value="PATCH">PATCH</option>
                <option value="DELETE">DELETE</option>
              </select>
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="httpHeaders">Headers (JSON, tenant-held — never sent to the model)</Label>
            <Textarea
              id="httpHeaders"
              rows={4}
              value={httpHeadersJson}
              onChange={(e) => setHttpHeadersJson(e.target.value)}
              className="font-mono text-[12px]"
              placeholder='{"authorization": "Bearer …"}'
            />
          </div>
        </div>
      ) : null}

      <div className="flex gap-3">
        <Button
          disabled={pending || !name.trim() || !description.trim()}
          onClick={() =>
            onSave({
              id: initial.id || undefined,
              name,
              description,
              kind,
              argsSchemaJson,
              requiresApproval,
              isEnabled,
              roleAllowlist: [...allowlist].filter((r): r is (typeof CALLER_ROLES)[number] =>
                (CALLER_ROLES as readonly string[]).includes(r)
              ),
              httpUrl: kind === "HTTP" ? httpUrl : null,
              httpMethod: kind === "HTTP" ? httpMethod : null,
              httpHeadersJson: kind === "HTTP" ? httpHeadersJson || null : null,
              retryLimit,
            })
          }
        >
          {pending ? "Saving…" : "Save"}
        </Button>
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
