import { listIntents } from "@/actions/intentTaxonomy";
import { IntentsForm } from "./intents-form";

export default async function IntentsPage() {
  const intents = await listIntents();
  return (
    <div>
      <h1 className="text-2xl font-bold mb-2">Intent taxonomy</h1>
      <p className="text-[13px] text-[var(--color-neutral-600)] mb-6">
        Each inbound message is classified into one of these intents. Edit the list to match your product surface —
        the AI is constrained to what you configure here.
      </p>
      <IntentsForm intents={intents} />
    </div>
  );
}
