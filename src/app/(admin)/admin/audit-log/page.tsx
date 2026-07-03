import { listAuditLog } from "@/actions/admin";

export default async function AuditLogPage({
  searchParams,
}: {
  searchParams: Promise<{ action?: string }>;
}) {
  const sp = await searchParams;
  const entries = await listAuditLog({ action: sp.action });

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Audit log</h1>
      <div className="bg-white border border-[var(--color-neutral-300)] rounded overflow-hidden">
        {entries.length === 0 ? (
          <p className="p-8 text-center text-sm text-[var(--color-neutral-600)]">No activity yet.</p>
        ) : (
          <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-[var(--color-light-gray)] text-[11px] uppercase-label text-[var(--color-neutral-700)]">
              <tr>
                <th className="text-left font-semibold px-4 py-2.5">When</th>
                <th className="text-left font-semibold px-4 py-2.5">Actor</th>
                <th className="text-left font-semibold px-4 py-2.5">Action</th>
                <th className="text-left font-semibold px-4 py-2.5">Change</th>
                <th className="text-left font-semibold px-4 py-2.5">Ticket</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id} className="border-t border-[var(--color-neutral-100)]">
                  <td className="px-4 py-3 text-[var(--color-neutral-600)] font-mono text-[12px]">
                    {new Date(e.createdAt).toLocaleString()}
                  </td>
                  <td className="px-4 py-3">
                    {
                      // IMPERSONATION_* entries record the actor's identity directly in
                      // toValue, since actorId can point at a different tenant's User row
                      // (unreadable under RLS once impersonation flips the session's role
                      // to ADMIN — see src/actions/super.ts) — show that instead of "System".
                      e.actor?.name ?? (e.action.startsWith("IMPERSONATION_") ? e.toValue : null) ?? "System"
                    }
                  </td>
                  <td className="px-4 py-3 font-mono text-[12px]">{e.action}</td>
                  <td className="px-4 py-3 text-[var(--color-neutral-600)]">
                    {e.action.startsWith("IMPERSONATION_")
                      ? "—"
                      : e.fromValue || e.toValue
                        ? `${e.fromValue ?? "—"} → ${e.toValue ?? "—"}`
                        : "—"}
                  </td>
                  <td className="px-4 py-3">
                    {e.ticket ? <span className="font-mono text-[12px] text-[var(--color-primary)]">{e.ticket.reference}</span> : "—"}
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
