import { listKbSuggestions } from "@/actions/kbSuggestions";
import { SuggestionsList } from "./suggestions-list";

export default async function KbSuggestionsPage() {
  const suggestions = await listKbSuggestions();
  return (
    <div>
      <h1 className="text-2xl font-bold mb-1">KB suggestions</h1>
      <p className="text-sm text-[var(--color-neutral-600)] mb-6">
        The self-learning KB clusters resolved tickets with no strong match against your knowledge base and drafts an
        article grounded in the actual resolutions. Every draft is filed here for human review — nothing is published
        automatically.
      </p>
      <SuggestionsList suggestions={suggestions} />
    </div>
  );
}
