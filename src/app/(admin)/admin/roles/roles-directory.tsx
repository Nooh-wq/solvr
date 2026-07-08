"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  createCustomRole,
  updateCustomRole,
  deleteCustomRole,
} from "@/actions/roles";
import { PERMISSION_CATEGORIES, ALL_PERMISSION_KEYS } from "@/lib/permissions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";

type RoleRow = {
  id: string;
  name: string;
  isCustom: boolean;
  permissions: Record<string, boolean>;
};

export function RolesDirectory({ initialRoles }: { initialRoles: RoleRow[] }) {
  const router = useRouter();
  const { toast } = useToast();
  const [selectedId, setSelectedId] = useState<string | null>(
    initialRoles.find((r) => r.isCustom)?.id ?? initialRoles[0]?.id ?? null
  );
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [pending, startTransition] = useTransition();

  const roles = initialRoles;
  const selected = roles.find((r) => r.id === selectedId) ?? null;

  function onCreate() {
    if (!newName.trim()) return;
    const name = newName.trim();
    startTransition(async () => {
      try {
        const role = await createCustomRole({ name, permissions: {} });
        setCreateOpen(false);
        setNewName("");
        setSelectedId(role.id);
        toast({ title: "Role created", variant: "success" });
        router.refresh();
      } catch (e) {
        toast({
          title: "Couldn't create role",
          description: e instanceof Error ? e.message : undefined,
          variant: "error",
        });
      }
    });
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-6">
      {/* Sidebar list */}
      <div className="bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl p-3 space-y-1">
        {roles.map((r) => (
          <button
            key={r.id}
            onClick={() => setSelectedId(r.id)}
            className={`w-full text-left px-3 py-2 rounded-lg text-[13px] transition-colors cursor-pointer ${
              r.id === selectedId
                ? "bg-[var(--color-primary)] text-white"
                : "text-[var(--foreground)] hover:bg-black/[0.04] dark:hover:bg-white/[0.06]"
            }`}
          >
            <div className="font-medium truncate">{r.name}</div>
            <div
              className={`text-[10px] uppercase tracking-wide ${
                r.id === selectedId ? "text-white/80" : "text-[var(--color-neutral-500)]"
              }`}
            >
              {r.isCustom ? "Custom" : "Standard"}
            </div>
          </button>
        ))}
        <button
          onClick={() => setCreateOpen(true)}
          className="w-full mt-2 px-3 py-2 rounded-lg text-[13px] font-medium border border-dashed border-[var(--color-neutral-400)] text-[var(--color-neutral-600)] hover:text-[var(--foreground)] hover:border-[var(--color-neutral-600)] cursor-pointer"
        >
          + New role
        </button>
      </div>

      {/* Editor */}
      <div className="bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl p-6 min-h-[400px]">
        {selected ? (
          <RoleEditor
            key={selected.id}
            role={selected}
            onDeleted={() => {
              setSelectedId(roles.find((r) => r.id !== selected.id)?.id ?? null);
              router.refresh();
            }}
          />
        ) : (
          <div className="text-[13px] text-[var(--color-neutral-500)]">Select a role to edit.</div>
        )}
      </div>

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="New role">
        <p className="text-[12px] text-[var(--color-neutral-600)] mb-3">
          Custom roles start with no permissions. Toggle them on after creating.
        </p>
        <Input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="Role name"
          autoFocus
        />
        <div className="flex justify-end gap-2 mt-3">
          <Button variant="secondary" onClick={() => setCreateOpen(false)}>
            Cancel
          </Button>
          <Button onClick={onCreate} disabled={pending || !newName.trim()}>
            {pending ? "Creating…" : "Create role"}
          </Button>
        </div>
      </Modal>
    </div>
  );
}

function RoleEditor({ role, onDeleted }: { role: RoleRow; onDeleted: () => void }) {
  const router = useRouter();
  const { toast } = useToast();
  const [name, setName] = useState(role.name);
  const [permissions, setPermissions] = useState<Record<string, boolean>>(() => {
    const seed: Record<string, boolean> = {};
    for (const k of ALL_PERMISSION_KEYS) seed[k] = Boolean(role.permissions[k]);
    return seed;
  });
  const [pending, startTransition] = useTransition();

  const readOnly = !role.isCustom;
  const dirty =
    name !== role.name ||
    ALL_PERMISSION_KEYS.some((k) => Boolean(role.permissions[k]) !== permissions[k]);

  function toggle(key: string) {
    if (readOnly) return;
    setPermissions((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  function save() {
    startTransition(async () => {
      try {
        await updateCustomRole({ id: role.id, name, permissions });
        toast({ title: "Role saved", variant: "success" });
        router.refresh();
      } catch (e) {
        toast({
          title: "Couldn't save role",
          description: e instanceof Error ? e.message : undefined,
          variant: "error",
        });
      }
    });
  }

  function remove() {
    if (!confirm(`Delete role "${role.name}"? This can only be done when no team member holds it.`)) return;
    startTransition(async () => {
      try {
        await deleteCustomRole(role.id);
        toast({ title: "Role deleted", variant: "success" });
        onDeleted();
      } catch (e) {
        toast({
          title: "Couldn't delete role",
          description: e instanceof Error ? e.message : undefined,
          variant: "error",
        });
      }
    });
  }

  return (
    <div>
      <div className="flex items-start justify-between gap-4 mb-6">
        <div className="flex-1 min-w-0">
          <label className="text-[11px] uppercase tracking-wide text-[var(--color-neutral-500)]">
            Role name
          </label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={readOnly || pending}
            className="mt-1"
          />
          {readOnly && (
            <p className="text-[11px] text-[var(--color-neutral-500)] mt-2">
              This is a standard role. Its name and permissions are fixed.
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0 pt-5">
          {role.isCustom && (
            <Button variant="secondary" onClick={remove} disabled={pending}>
              Delete
            </Button>
          )}
          <Button onClick={save} disabled={pending || !dirty || readOnly}>
            {pending ? "Saving…" : "Save changes"}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {PERMISSION_CATEGORIES.map((cat) => (
          <div
            key={cat.key}
            className="border border-[var(--color-neutral-300)] rounded-xl p-4"
          >
            <h3 className="text-[13px] font-semibold mb-3">{cat.label}</h3>
            <div className="space-y-2">
              {cat.permissions.map((p) => {
                const checked = permissions[p.key] ?? false;
                return (
                  <label
                    key={p.key}
                    className={`flex items-start gap-3 ${readOnly ? "opacity-70" : "cursor-pointer"}`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggle(p.key)}
                      disabled={readOnly || pending}
                      className="mt-0.5 h-4 w-4 accent-[var(--color-primary)] cursor-pointer disabled:cursor-not-allowed"
                    />
                    <span>
                      <span className="block text-[12px] font-medium leading-tight">
                        {p.label}
                      </span>
                      <span className="block text-[11px] text-[var(--color-neutral-500)] leading-snug">
                        {p.description}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
