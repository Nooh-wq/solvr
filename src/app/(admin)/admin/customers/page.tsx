import { listCustomers } from "@/actions/people";
import { CustomersDirectory } from "./customers-directory";

// Z3.1 — Dedicated Customers surface. Splits end-user rows out of the
// legacy /admin/team page (now retired in favor of /admin/team-members).
// Server component: hydrates the whole table in one round-trip; the
// directory does client-side filter/sort. Cursor pagination + CSV
// import/export land in Z3.6.

export default async function CustomersPage() {
  const customers = await listCustomers();
  // UNVERIFIED accounts (client signed up but hasn't confirmed OTP) are
  // transient and would clutter the directory with rows admins can't
  // act on — same rule the old /admin/team page used.
  const visible = customers.filter((c) => c.status !== "UNVERIFIED");

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Customers</h1>
      <CustomersDirectory
        customers={visible.map((c) => ({
          id: c.id,
          name: c.name ?? c.email,
          email: c.email,
          status: c.status,
          organizationName: c.organizationName,
          tags: c.tags,
          ticketCount: c.ticketCount,
          lastActiveAt: c.lastActiveAt ? c.lastActiveAt.toISOString() : null,
          csatAvg: c.csatAvg,
          csatCount: c.csatCount,
          avatarUrl: c.avatarUrl,
        }))}
      />
    </div>
  );
}
