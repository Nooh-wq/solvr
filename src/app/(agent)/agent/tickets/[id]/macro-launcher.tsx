"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { applyMacro, undoMacroApply } from "@/actions/macros";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { expand, type PlaceholderContext } from "@/lib/placeholders";
import type { MacroAction } from "@/lib/macros";
import { describeAction } from "@/lib/macros";

// Z6.4 — macro launcher chip that lives in the ticket-detail header
// (or wherever the caller mounts it). Shows a preview modal listing
// every action before the agent commits. After apply, a toast surfaces
// how many actions ran + a 10s undo affordance for status/priority
// changes.

type MacroOption = {
  id: string;
  name: string;
  description: string | null;
  actions: MacroAction[];
  isShared: boolean;
};

export function MacroLauncher({
  ticketId,
  macros,
  placeholderContext,
}: {
  ticketId: string;
  macros: MacroOption[];
  /** Expands `insert_reply_template` bodies inside the preview. */
  placeholderContext?: PlaceholderContext;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (macros.length === 0) return null;

  const selected = macros.find((m) => m.id === selectedId) ?? null;

  function apply() {
    if (!selected) return;
    startTransition(async () => {
      try {
        const res = await applyMacro({ macroId: selected.id, ticketId });
        setOpen(false);
        setSelectedId(null);
        router.refresh();

        // Insert reply templates get dropped into the console for now —
        // wiring them straight into the composer needs a shared client
        // event bus which isn't set up yet. Called out in follow-ups.
        if (res.insertReplyBodies.length > 0) {
          console.info("[macro] insert_reply_template bodies:", res.insertReplyBodies);
        }

        toast({
          title: `Macro applied · ${res.ranActionCount}/${res.ranActionCount + res.skipped.length} actions`,
          description:
            res.skipped.length > 0
              ? `${res.skipped.length} action(s) skipped: ${res.skipped
                  .map((s) => s.reason)
                  .join("; ")}`
              : undefined,
          variant: res.skipped.length === 0 ? "success" : "error",
          // 10s undo — enforced by the toast lifetime.
          duration: 10_000,
          action:
            res.undo && (res.undo.previousStatus || res.undo.previousPriority)
              ? {
                  label: "Undo",
                  onClick: async () => {
                    try {
                      await undoMacroApply({
                        ticketId,
                        previousStatus: res.undo?.previousStatus as
                          | "OPEN"
                          | "IN_PROGRESS"
                          | "PENDING"
                          | "RESOLVED"
                          | "CLOSED"
                          | undefined,
                        previousPriority: res.undo?.previousPriority as
                          | "LOW"
                          | "MEDIUM"
                          | "HIGH"
                          | "URGENT"
                          | undefined,
                      });
                      toast({ title: "Undone", variant: "success" });
                      router.refresh();
                    } catch (e) {
                      toast({
                        title: "Couldn't undo",
                        description: e instanceof Error ? e.message : undefined,
                        variant: "error",
                      });
                    }
                  },
                }
              : undefined,
        });
      } catch (e) {
        toast({
          title: "Couldn't apply macro",
          description: e instanceof Error ? e.message : undefined,
          variant: "error",
        });
      }
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpen(true);
          setSelectedId(macros[0]?.id ?? null);
        }}
        className="text-[12px] font-medium px-2.5 py-1 rounded-md border border-[var(--color-neutral-300)] text-[var(--color-neutral-700)] hover:bg-black/[0.04] dark:hover:bg-white/[0.06] hover:text-[var(--foreground)] cursor-pointer"
      >
        Apply macro
      </button>

      <Modal open={open} onClose={() => setOpen(false)} title="Apply macro">
        <div className="grid grid-cols-[200px_1fr] gap-4 min-h-[220px]">
          <div className="border-r border-[var(--color-neutral-200)] pr-3 space-y-1 max-h-[320px] overflow-y-auto">
            {macros.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => setSelectedId(m.id)}
                className={`w-full text-left px-2.5 py-1.5 rounded-md text-[13px] transition-colors cursor-pointer ${
                  m.id === selectedId
                    ? "bg-[var(--color-primary)] text-white"
                    : "text-[var(--foreground)] hover:bg-black/[0.04] dark:hover:bg-white/[0.06]"
                }`}
              >
                <div className="font-medium truncate">{m.name}</div>
                <div
                  className={`text-[10px] uppercase tracking-wide ${
                    m.id === selectedId ? "text-white/80" : "text-[var(--color-neutral-500)]"
                  }`}
                >
                  {m.isShared ? "Shared" : "Personal"} · {m.actions.length} action
                  {m.actions.length === 1 ? "" : "s"}
                </div>
              </button>
            ))}
          </div>
          <div>
            {selected ? (
              <div>
                <p className="text-[12px] text-[var(--color-neutral-600)] mb-2">
                  {selected.description ?? "This macro will run the actions below when you confirm."}
                </p>
                <ol className="space-y-1.5 text-[13px]">
                  {selected.actions.map((a, i) => {
                    let summary = describeAction(a);
                    if (
                      a.type === "insert_reply_template" &&
                      placeholderContext
                    ) {
                      const expanded = expand(a.body, placeholderContext, "text");
                      summary = `Insert reply template — "${
                        expanded.length > 80
                          ? expanded.slice(0, 80) + "…"
                          : expanded
                      }"`;
                    }
                    return (
                      <li
                        key={i}
                        className="flex items-start gap-2 rounded-md border border-[var(--color-neutral-200)] px-3 py-2"
                      >
                        <span className="shrink-0 h-5 w-5 rounded-full bg-[var(--color-neutral-100)] dark:bg-white/[0.08] text-[11px] font-semibold flex items-center justify-center">
                          {i + 1}
                        </span>
                        <span className="text-[12px] text-[var(--foreground)]">{summary}</span>
                      </li>
                    );
                  })}
                </ol>
              </div>
            ) : (
              <div className="text-[12px] text-[var(--color-neutral-500)]">
                Select a macro on the left.
              </div>
            )}
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-4">
          <Button variant="secondary" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            onClick={apply}
            disabled={pending || !selected || selected.actions.length === 0}
          >
            {pending ? "Applying…" : `Apply ${selected?.actions.length ?? 0} action${selected?.actions.length === 1 ? "" : "s"}`}
          </Button>
        </div>
      </Modal>
    </>
  );
}
