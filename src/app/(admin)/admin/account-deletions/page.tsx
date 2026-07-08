import { listPendingAccountDeletions } from "@/actions/accountDeletions";
import { AccountDeletionsList } from "./deletions-list";

export default async function AccountDeletionsPage() {
  const rows = await listPendingAccountDeletions();
  return (
    <div>
      <h1 className="text-2xl font-bold mb-2">Account deletion requests</h1>
      <p className="text-[13px] text-[var(--color-neutral-600)] mb-6">
        Users who asked to have their accounts deleted. Approving a request
        permanently removes them; rejecting keeps their account active.
      </p>
      <AccountDeletionsList rows={rows} />
    </div>
  );
}
