"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  createCannedResponse,
  updateCannedResponse,
  deleteCannedResponse,
} from "@/actions/cannedResponses";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { PLACEHOLDER_KEYS } from "@/lib/placeholders";

type Row = {
  id: string;
  name: string;
  shortcut: string;
  body: string;
  isShared: boolean;
  isOwned: boolean;
};

export function CannedResponsesEditor({
  initialRows,
  canShare,
  actingSubjectId: _actingSubjectId,
}: {
  initialRows: Row[];
  canShare: boolean;
  actingSubjectId: string;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [selectedId, setSelectedId] = useState<string | null>(initialRows[0]?.id ?? null);
  const [createOpen, setCreateOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const rows = initialRows;
  const selected = rows.find((r) => r.id === selectedId) ?? null;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-6">
      <aside className="bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl p-3 space-y-1 h-fit">
        {rows.length === 0 ? (
          <p className="px-3 py-2 text-[12px] text-[var(--color-neutral-500)]">
            No canned responses yet.
          </p>
        ) : (
          rows.map((r) => (
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
                className={`text-[11px] font-mono ${
                  r.id === selectedId ? "text-white/80" : "text-[var(--color-neutral-500)]"
                }`}
              >
                /{r.shortcut}
              </div>
              <div
                className={`text-[10px] uppercase tracking-wide ${
                  r.id === selectedId ? "text-white/80" : "text-[var(--color-neutral-500)]"
                }`}
              >
                {r.isShared ? "Shared" : "Personal"}
              </div>
            </button>
          ))
        )}
        <button
          onClick={() => setCreateOpen(true)}
          className="w-full mt-2 px-3 py-2 rounded-lg text-[13px] font-medium border border-dashed border-[var(--color-neutral-400)] text-[var(--color-neutral-600)] hover:text-[var(--foreground)] hover:border-[var(--color-neutral-600)] cursor-pointer"
        >
          + New response
        </button>
      </aside>

      <div className="bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl p-6 min-h-[400px]">
        {selected ? (
          <ResponseEditor
            key={selected.id}
            row={selected}
            onDeleted={() => {
              setSelectedId(rows.find((r) => r.id !== selected.id)?.id ?? null);
              router.refresh();
            }}
          />
        ) : (
          <div className="text-[13px] text-[var(--color-neutral-500)]">
            Select or create a canned response to edit.
          </div>
        )}
      </div>

      <CreateModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        canShare={canShare}
        onCreated={(id) => {
          setSelectedId(id);
          setCreateOpen(false);
          router.refresh();
        }}
        pending={pending}
        startTransition={startTransition}
        toast={toast}
      />
    </div>
  );
}

function ResponseEditor({ row, onDeleted }: { row: Row; onDeleted: () => void }) {
  const router = useRouter();
  const { toast } = useToast();
  const [name, setName] = useState(row.name);
  const [shortcut, setShortcut] = useState(row.shortcut);
  const [body, setBody] = useState(row.body);
  const [pending, startTransition] = useTransition();

  const readOnly = !row.isOwned && row.isShared === false ? true : !row.isOwned && row.isShared;
  // Simpler read: editable if the row is yours (personal) or if it's shared
  // and you got into this editor as an admin (server enforces the actual
  // check; the sidebar row wouldn't be selectable if the read policy
  // blocked us anyway).
  const canEdit = row.isOwned || row.isShared;
  const dirty = name !== row.name || shortcut !== row.shortcut || body !== row.body;

  function save() {
    startTransition(async () => {
      try {
        await updateCannedResponse({ id: row.id, name, shortcut, body });
        toast({ title: "Canned response saved", variant: "success" });
        router.refresh();
      } catch (e) {
        toast({
          title: "Couldn't save",
          description: e instanceof Error ? e.message : undefined,
          variant: "error",
        });
      }
    });
  }

  function remove() {
    if (!confirm(`Delete "${row.name}"?`)) return;
    startTransition(async () => {
      try {
        await deleteCannedResponse(row.id);
        toast({ title: "Deleted", variant: "success" });
        onDeleted();
      } catch (e) {
        toast({
          title: "Couldn't delete",
          description: e instanceof Error ? e.message : undefined,
          variant: "error",
        });
      }
    });
  }

  return (
    <div>
      <div className="flex items-start justify-between gap-4 mb-4">
        <div className="flex-1 min-w-0 space-y-3">
          <div>
            <label className="text-[11px] uppercase tracking-wide text-[var(--color-neutral-500)]">
              Name
            </label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={!canEdit || pending}
              className="mt-1"
            />
          </div>
          <div>
            <label className="text-[11px] uppercase tracking-wide text-[var(--color-neutral-500)]">
              Shortcut
            </label>
            <div className="mt-1 flex items-center gap-1">
              <span className="text-[13px] text-[var(--color-neutral-500)] font-mono">/</span>
              <Input
                value={shortcut}
                onChange={(e) => setShortcut(e.target.value.toLowerCase())}
                disabled={!canEdit || pending}
                className="font-mono"
              />
            </div>
            <p className="text-[11px] text-[var(--color-neutral-500)] mt-1">
              Lowercase letters, numbers, and dashes only.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0 pt-5">
          {canEdit && (
            <Button variant="secondary" onClick={remove} disabled={pending}>
              Delete
            </Button>
          )}
          <Button onClick={save} disabled={pending || !dirty || !canEdit}>
            {pending ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>

      <label className="text-[11px] uppercase tracking-wide text-[var(--color-neutral-500)]">
        Body
      </label>
      <Textarea
        rows={10}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        disabled={!canEdit || pending}
        className="mt-1 font-sans"
      />
      <details className="mt-3 text-[12px] text-[var(--color-neutral-600)]">
        <summary className="cursor-pointer select-none">Available placeholders</summary>
        <div className="mt-2 grid grid-cols-2 md:grid-cols-3 gap-1 text-[11px] font-mono">
          {PLACEHOLDER_KEYS.map((k) => (
            <code key={k} className="bg-[var(--color-neutral-100)] dark:bg-white/[0.06] px-2 py-1 rounded">
              {`{{${k}}}`}
            </code>
          ))}
        </div>
      </details>
    </div>
  );
}

function CreateModal({
  open,
  onClose,
  canShare,
  onCreated,
  pending,
  startTransition,
  toast,
}: {
  open: boolean;
  onClose: () => void;
  canShare: boolean;
  onCreated: (id: string) => void;
  pending: boolean;
  startTransition: React.TransitionStartFunction;
  toast: (o: { title: string; description?: string; variant?: "success" | "error" }) => void;
}) {
  const [name, setName] = useState("");
  const [shortcut, setShortcut] = useState("");
  const [body, setBody] = useState("");
  const [shared, setShared] = useState(false);

  function submit() {
    if (!name.trim() || !shortcut.trim() || !body.trim()) return;
    startTransition(async () => {
      try {
        const res = await createCannedResponse({ name, shortcut, body, shared });
        setName("");
        setShortcut("");
        setBody("");
        setShared(false);
        onCreated(res.id);
        toast({ title: "Canned response created", variant: "success" });
      } catch (e) {
        toast({
          title: "Couldn't create",
          description: e instanceof Error ? e.message : undefined,
          variant: "error",
        });
      }
    });
  }

  return (
    <Modal open={open} onClose={onClose} title="New canned response">
      <div className="space-y-3">
        <div>
          <label className="text-[11px] uppercase tracking-wide text-[var(--color-neutral-500)]">
            Name
          </label>
          <Input value={name} onChange={(e) => setName(e.target.value)} className="mt-1" autoFocus />
        </div>
        <div>
          <label className="text-[11px] uppercase tracking-wide text-[var(--color-neutral-500)]">
            Shortcut
          </label>
          <div className="mt-1 flex items-center gap-1">
            <span className="text-[13px] text-[var(--color-neutral-500)] font-mono">/</span>
            <Input
              value={shortcut}
              onChange={(e) => setShortcut(e.target.value.toLowerCase())}
              placeholder="verify-identity"
              className="font-mono"
            />
          </div>
        </div>
        <div>
          <label className="text-[11px] uppercase tracking-wide text-[var(--color-neutral-500)]">
            Body
          </label>
          <Textarea
            rows={6}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Hi {{ticket.requester.name}}, thanks for reaching out about {{ticket.title}}…"
            className="mt-1"
          />
        </div>
        {canShare && (
          <label className="flex items-start gap-2 text-[12px]">
            <input
              type="checkbox"
              checked={shared}
              onChange={(e) => setShared(e.target.checked)}
              className="mt-0.5 h-4 w-4 accent-[var(--color-primary)] cursor-pointer"
            />
            <span>
              <span className="block font-medium">Share with team</span>
              <span className="block text-[var(--color-neutral-500)]">
                Any agent can use it; only admins can edit or delete.
              </span>
            </span>
          </label>
        )}
      </div>
      <div className="flex justify-end gap-2 mt-4">
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button
          onClick={submit}
          disabled={pending || !name.trim() || !shortcut.trim() || !body.trim()}
        >
          {pending ? "Creating…" : "Create"}
        </Button>
      </div>
    </Modal>
  );
}
