import { listPendingApprovalsForMe } from "@/actions/approvalRequests";
import { ApprovalsList } from "./approvals-list";

export default async function ApprovalsPage() {
  const items = await listPendingApprovalsForMe();
  return (
    <div className="p-6 max-w-3xl mx-auto">
      <h1 className="text-2xl font-bold mb-1">Approvals</h1>
      <p className="text-sm text-[var(--color-neutral-600)] mb-6">
        Requests waiting on your decision.
      </p>
      <ApprovalsList items={items} />
    </div>
  );
}
