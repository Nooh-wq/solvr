import { listFlaggedScores } from "@/actions/qaScores";
import { FlaggedList } from "./flagged-list";

export default async function QaFlaggedPage() {
  const items = await listFlaggedScores();
  return (
    <div>
      <h1 className="text-2xl font-bold mb-1">Flagged replies</h1>
      <p className="text-sm text-[var(--color-neutral-600)] mb-6">
        Replies where at least one rubric dimension scored below its flag threshold. Reviewing here doesn&apos;t change the
        score — it&apos;s a coaching signal only.
      </p>
      <FlaggedList items={items} />
    </div>
  );
}
