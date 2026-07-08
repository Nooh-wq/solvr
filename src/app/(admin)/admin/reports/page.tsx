import { listSavedReports } from "@/actions/reports";
import { requireSession } from "@/lib/auth";
import { withRls } from "@/lib/db";
import { ReportsEditor } from "./reports-editor";

export default async function ReportsAdminPage() {
  const session = await requireSession({ minRole: "ADMIN" });
  const reports = await listSavedReports();

  // Feed the editor's filter dropdowns from the same tenant-scoped tables
  // the analytics filter bar uses. Kept in the page (server-only) so the
  // client bundle stays small.
  const { categories, organizations } = await withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    async (tx) => {
      const [categories, organizations] = await Promise.all([
        tx.category.findMany({
          where: { tenantId: session.tenantId, isActive: true },
          orderBy: { name: "asc" },
          select: { id: true, name: true },
        }),
        tx.organization.findMany({
          where: { tenantId: session.tenantId },
          orderBy: { name: "asc" },
          take: 500,
          select: { id: true, name: true },
        }),
      ]);
      return { categories, organizations };
    }
  );

  return (
    <div>
      <h1 className="text-2xl font-semibold mb-1">Reports</h1>
      <p className="mt-2 text-[13px] text-[var(--color-neutral-600)] max-w-2xl mb-6">
        Save filter combinations for quick access on the Analytics dashboard
        and export the underlying tickets as CSV.
      </p>
      <ReportsEditor
        initialReports={reports}
        categories={categories}
        organizations={organizations}
      />
    </div>
  );
}
