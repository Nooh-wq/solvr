import { listPendingAiActions } from "@/actions/aiActionQueue";
import { QueueList } from "./queue-list";

export default async function AiActionsPage() {
  const pending = await listPendingAiActions();
  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-1">AI actions</h1>
      <p className="text-sm text-[var(--color-neutral-600)] mb-6">
        Proposed AI tool calls waiting for a human decision. Approving executes the tool now under the caller&apos;s
        original context; rejecting closes the item without running anything.
      </p>
      <QueueList items={pending} />
    </div>
  );
}
