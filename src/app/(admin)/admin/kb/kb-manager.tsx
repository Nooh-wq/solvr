"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { upsertKbArticle, deleteKbArticle, markKbArticleReviewed } from "@/actions/kb";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";

type Article = { id: string; title: string; body: string; isPublished: boolean; updatedAt: string; isStale?: boolean };

export function KbManager({
  articles,
  staleThresholdMonths,
}: {
  articles: Article[];
  staleThresholdMonths?: number;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [editing, setEditing] = useState<Article | null>(null);
  const [creating, setCreating] = useState(false);
  const [pending, startTransition] = useTransition();

  function reviewed(id: string, title: string) {
    startTransition(async () => {
      try {
        await markKbArticleReviewed(id);
        toast({ title: "Marked reviewed", description: title, variant: "success" });
        router.refresh();
      } catch (e) {
        toast({
          title: "Couldn't update",
          description: e instanceof Error ? e.message : undefined,
          variant: "error",
        });
      }
    });
  }

  function remove(id: string, title: string) {
    startTransition(async () => {
      try {
        await deleteKbArticle(id);
        toast({ title: "Article deleted", description: title, variant: "success" });
        router.refresh();
      } catch (e) {
        toast({ title: "Couldn't delete article", description: e instanceof Error ? e.message : undefined, variant: "error" });
      }
    });
  }

  if (editing || creating) {
    return (
      <ArticleEditor
        initial={editing}
        pending={pending}
        onCancel={() => {
          setEditing(null);
          setCreating(false);
        }}
        onSave={(values) => {
          startTransition(async () => {
            try {
              await upsertKbArticle({ id: editing?.id, ...values });
              toast({ title: editing ? "Article updated" : "Article created", description: values.title, variant: "success" });
              setEditing(null);
              setCreating(false);
              router.refresh();
            } catch (e) {
              toast({ title: "Couldn't save article", description: e instanceof Error ? e.message : undefined, variant: "error" });
            }
          });
        }}
      />
    );
  }

  return (
    <div>
      <div className="flex justify-end mb-4">
        <Button size="sm" onClick={() => setCreating(true)}>
          New article
        </Button>
      </div>
      <div className="bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl overflow-hidden">
        {articles.length === 0 ? (
          <p className="p-8 text-center text-sm text-[var(--color-neutral-600)]">No articles yet.</p>
        ) : (
          <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-[var(--color-light-gray)] text-[11px] uppercase-label text-[var(--color-neutral-700)]">
              <tr>
                <th className="text-left font-semibold px-4 py-2.5">Title</th>
                <th className="text-left font-semibold px-4 py-2.5">Status</th>
                <th className="text-left font-semibold px-4 py-2.5">Updated</th>
                <th className="text-left font-semibold px-4 py-2.5"></th>
              </tr>
            </thead>
            <tbody>
              {articles.map((a) => (
                <tr key={a.id} className="border-t border-[var(--color-neutral-100)]">
                  <td className="px-4 py-3">
                    <button onClick={() => setEditing(a)} className="text-left text-[var(--color-primary)] font-medium">
                      {a.title}
                    </button>
                    {a.isStale ? (
                      <span
                        title={
                          staleThresholdMonths
                            ? `Not reviewed in ${staleThresholdMonths} months`
                            : "Stale"
                        }
                        className="ml-2 inline-flex items-center px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-200 text-[10px] font-semibold uppercase tracking-wide"
                      >
                        Stale
                      </span>
                    ) : null}
                  </td>
                  <td className="px-4 py-3">{a.isPublished ? "Published" : "Draft"}</td>
                  <td className="px-4 py-3 text-[var(--color-neutral-600)]">
                    {new Date(a.updatedAt).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2 justify-end">
                      {a.isStale ? (
                        <Button
                          variant="secondary"
                          size="sm"
                          disabled={pending}
                          onClick={() => reviewed(a.id, a.title)}
                        >
                          Mark reviewed
                        </Button>
                      ) : null}
                      <Button variant="secondary" size="sm" disabled={pending} onClick={() => remove(a.id, a.title)}>
                        Delete
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </div>
    </div>
  );
}

function ArticleEditor({
  initial,
  pending,
  onCancel,
  onSave,
}: {
  initial: Article | null;
  pending: boolean;
  onCancel: () => void;
  onSave: (values: { title: string; body: string; isPublished: boolean }) => void;
}) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [body, setBody] = useState(initial?.body ?? "");
  const [isPublished, setIsPublished] = useState(initial?.isPublished ?? false);

  return (
    <div className="bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl p-5 max-w-2xl space-y-3">
      <div className="space-y-1">
        <Label htmlFor="kbTitle">Title</Label>
        <Input id="kbTitle" value={title} onChange={(e) => setTitle(e.target.value)} />
      </div>
      <div className="space-y-1">
        <Label htmlFor="kbBody">Body</Label>
        <Textarea id="kbBody" rows={10} value={body} onChange={(e) => setBody(e.target.value)} />
      </div>
      <label className="flex items-center gap-2 text-[13px] text-[var(--color-neutral-700)]">
        <input type="checkbox" checked={isPublished} onChange={(e) => setIsPublished(e.target.checked)} />
        Published (visible to the chatbot and clients)
      </label>
      <div className="flex gap-3">
        <Button disabled={pending || !title.trim() || !body.trim()} onClick={() => onSave({ title, body, isPublished })}>
          {pending ? "Saving…" : "Save"}
        </Button>
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
