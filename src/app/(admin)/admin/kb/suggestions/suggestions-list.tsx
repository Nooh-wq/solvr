"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { acceptKbSuggestion, rejectKbSuggestion } from "@/actions/kbSuggestions";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";

type Suggestion = {
  id: string;
  title: string;
  body: string;
  reason: string | null;
  createdAt: string;
  sourceTickets: Array<{ id: string; reference: string; title: string }>;
};

export function SuggestionsList({ suggestions }: { suggestions: Suggestion[] }) {
  const router = useRouter();
  const { toast } = useToast();
  const [editing, setEditing] = useState<Suggestion | null>(null);
  const [pending, startTransition] = useTransition();

  if (suggestions.length === 0) {
    return (
      <div className="bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl p-8 text-center text-sm text-[var(--color-neutral-600)]">
        No pending suggestions. The nightly clustering job runs at 03:00 UTC.
      </div>
    );
  }

  if (editing) {
    return (
      <SuggestionEditor
        suggestion={editing}
        pending={pending}
        onCancel={() => setEditing(null)}
        onAccept={(values) =>
          startTransition(async () => {
            try {
              await acceptKbSuggestion({ id: editing.id, ...values });
              toast({ title: "Article published", description: values.title, variant: "success" });
              setEditing(null);
              router.refresh();
            } catch (e) {
              toast({
                title: "Couldn't publish",
                description: e instanceof Error ? e.message : undefined,
                variant: "error",
              });
            }
          })
        }
        onReject={(reason) =>
          startTransition(async () => {
            try {
              await rejectKbSuggestion({ id: editing.id, reason });
              toast({ title: "Suggestion rejected", variant: "success" });
              setEditing(null);
              router.refresh();
            } catch (e) {
              toast({
                title: "Couldn't reject",
                description: e instanceof Error ? e.message : undefined,
                variant: "error",
              });
            }
          })
        }
      />
    );
  }

  return (
    <div className="space-y-3">
      {suggestions.map((s) => (
        <button
          key={s.id}
          type="button"
          onClick={() => setEditing(s)}
          className="w-full text-left bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl p-5 hover:border-[var(--color-primary)] transition-colors cursor-pointer"
        >
          <div className="flex justify-between items-start gap-4">
            <div className="flex-1 min-w-0">
              <div className="text-[13px] font-semibold text-[var(--color-neutral-900)] mb-1">{s.title}</div>
              {s.reason ? (
                <div className="text-[12px] text-[var(--color-neutral-600)] mb-2">{s.reason}</div>
              ) : null}
              <div className="text-[12px] text-[var(--color-neutral-500)]">
                {s.sourceTickets.length} source ticket{s.sourceTickets.length === 1 ? "" : "s"} · drafted{" "}
                {new Date(s.createdAt).toLocaleDateString()}
              </div>
            </div>
            <div className="text-[12px] text-[var(--color-primary)] font-medium">Review →</div>
          </div>
        </button>
      ))}
    </div>
  );
}

function SuggestionEditor({
  suggestion,
  pending,
  onCancel,
  onAccept,
  onReject,
}: {
  suggestion: Suggestion;
  pending: boolean;
  onCancel: () => void;
  onAccept: (values: { title: string; body: string }) => void;
  onReject: (reason?: string) => void;
}) {
  const [title, setTitle] = useState(suggestion.title);
  const [body, setBody] = useState(suggestion.body);
  const [showReject, setShowReject] = useState(false);
  const [rejectReason, setRejectReason] = useState("");

  return (
    <div className="bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl p-5 max-w-3xl space-y-4">
      {suggestion.reason ? (
        <div className="text-[12px] text-[var(--color-neutral-600)]">{suggestion.reason}</div>
      ) : null}

      <div className="space-y-1">
        <Label htmlFor="sugTitle">Title</Label>
        <Input id="sugTitle" value={title} onChange={(e) => setTitle(e.target.value)} />
      </div>
      <div className="space-y-1">
        <Label htmlFor="sugBody">Body (Markdown)</Label>
        <Textarea id="sugBody" rows={16} value={body} onChange={(e) => setBody(e.target.value)} />
      </div>

      <div className="space-y-1">
        <div className="text-[12px] uppercase-label text-[var(--color-neutral-700)]">Source tickets</div>
        <ul className="text-[13px] space-y-1">
          {suggestion.sourceTickets.map((t) => (
            <li key={t.id}>
              <Link
                href={`/agent/tickets/${t.id}`}
                target="_blank"
                className="text-[var(--color-primary)] hover:underline"
              >
                {t.reference}
              </Link>{" "}
              — <span className="text-[var(--color-neutral-700)]">{t.title}</span>
            </li>
          ))}
        </ul>
      </div>

      {showReject ? (
        <div className="space-y-2 border-t border-[var(--color-neutral-200)] pt-4">
          <Label htmlFor="rejReason">Reason for rejecting (optional)</Label>
          <Textarea
            id="rejReason"
            rows={2}
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            placeholder="e.g. duplicate of existing article; incorrect steps; not a KB topic"
          />
          <div className="flex gap-2">
            <Button
              variant="secondary"
              disabled={pending}
              onClick={() => onReject(rejectReason.trim() || undefined)}
            >
              Confirm reject
            </Button>
            <Button variant="secondary" onClick={() => setShowReject(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex gap-3 flex-wrap">
          <Button
            disabled={pending || !title.trim() || !body.trim()}
            onClick={() => onAccept({ title, body })}
          >
            {pending ? "Publishing…" : "Accept + publish"}
          </Button>
          <Button variant="secondary" disabled={pending} onClick={() => setShowReject(true)}>
            Reject
          </Button>
          <Button variant="secondary" disabled={pending} onClick={onCancel}>
            Back
          </Button>
        </div>
      )}
    </div>
  );
}
