import Link from "next/link";
import { listAllViews } from "@/actions/workspaceSettings";
import { EmptyState } from "@/components/empty-state";

export const dynamic = "force-dynamic";

export default async function ViewsAdminPage() {
  const views = await listAllViews();
  const shared = views.filter((v) => v.isShared);
  const personal = views.filter((v) => !v.isShared);

  return (
    <div>
      <h1 className="text-2xl font-bold mb-1">Views</h1>
      <p className="text-sm text-[var(--color-neutral-600)] mb-6 max-w-2xl">
        Saved queue filters used across the agent workspace. Shared views appear for every agent;
        personal views are private to their owner. Agents create and edit their own views from{" "}
        <Link href="/agent" className="underline">
          Queue
        </Link>{" "}
        &rarr; &ldquo;Save as view&rdquo;.
      </p>

      {views.length === 0 ? (
        <EmptyState
          title="No saved views yet"
          description="When agents save their queue filters, they show up here."
          primaryCta={{ label: "Open Queue", href: "/agent" }}
        />
      ) : (
        <div className="space-y-6 max-w-4xl">
          <section>
            <h2 className="text-[13px] uppercase-label text-[var(--color-neutral-600)] mb-2">
              Shared views ({shared.length})
            </h2>
            {shared.length === 0 ? (
              <div className="p-4 rounded-2xl bg-[var(--color-neutral-100)] text-[13px] text-[var(--color-neutral-600)]">
                No shared views yet. Any agent can share their view from{" "}
                <Link href="/agent" className="underline">
                  Queue
                </Link>
                .
              </div>
            ) : (
              <ViewsTable rows={shared} showOwner={false} />
            )}
          </section>

          <section>
            <h2 className="text-[13px] uppercase-label text-[var(--color-neutral-600)] mb-2">
              Personal views ({personal.length})
            </h2>
            {personal.length === 0 ? (
              <div className="p-4 rounded-2xl bg-[var(--color-neutral-100)] text-[13px] text-[var(--color-neutral-600)]">
                No personal views yet.
              </div>
            ) : (
              <ViewsTable rows={personal} showOwner={true} />
            )}
          </section>
        </div>
      )}
    </div>
  );
}

function ViewsTable({
  rows,
  showOwner,
}: {
  rows: Awaited<ReturnType<typeof listAllViews>>;
  showOwner: boolean;
}) {
  return (
    <div className="bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-[var(--color-light-gray)] text-[11px] uppercase-label text-[var(--color-neutral-700)]">
          <tr>
            <th className="text-left font-semibold px-4 py-2.5">View</th>
            {showOwner ? <th className="text-left font-semibold px-4 py-2.5">Owner</th> : null}
            <th className="text-left font-semibold px-4 py-2.5">Default</th>
            <th className="text-left font-semibold px-4 py-2.5">Created</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((v) => (
            <tr key={v.id} className="border-t border-[var(--color-neutral-100)]">
              <td className="px-4 py-3 font-medium">{v.name}</td>
              {showOwner ? (
                <td className="px-4 py-3">
                  <div className="text-[13px]">{v.ownerName ?? "—"}</div>
                  <div className="text-[11px] text-[var(--color-neutral-500)]">{v.ownerEmail ?? ""}</div>
                </td>
              ) : null}
              <td className="px-4 py-3">
                {v.isDefault ? (
                  <span className="text-[11px] uppercase-label px-2 py-0.5 rounded-full bg-[var(--color-primary)]/10 text-[var(--color-primary)]">
                    Default
                  </span>
                ) : (
                  <span className="text-[11px] text-[var(--color-neutral-500)]">—</span>
                )}
              </td>
              <td className="px-4 py-3 font-mono text-[12px] text-[var(--color-neutral-600)]">
                {new Date(v.createdAt).toLocaleDateString()}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
