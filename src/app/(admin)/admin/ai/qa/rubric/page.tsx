import { listQaRubrics } from "@/actions/qaRubric";
import { RubricForm } from "./rubric-form";

export default async function QaRubricPage() {
  const rubrics = await listQaRubrics();
  return (
    <div>
      <h1 className="text-2xl font-bold mb-1">QA rubric</h1>
      <p className="text-sm text-[var(--color-neutral-600)] mb-6">
        The rubric the AI scores every sent reply against. Only one rubric can be active at a time. QA scores are
        coaching signal — they must not be tied to compensation without human review.
      </p>
      <RubricForm rubrics={rubrics} />
    </div>
  );
}
