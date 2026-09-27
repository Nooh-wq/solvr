import { listPrompts } from "@/actions/promptTemplates";
import { PromptsEditor } from "./prompts-editor";

export const dynamic = "force-dynamic";

export default async function PromptsPage() {
  const prompts = await listPrompts();
  return (
    <div>
      <h1 className="text-2xl font-bold mb-1">Prompt library</h1>
      <p className="text-sm text-[var(--color-neutral-600)] mb-6 max-w-2xl">
        Reusable prompt templates for the agent copilot. Use{" "}
        <code className="text-[11px]">{"{{variable}}"}</code> placeholders — agents fill them in
        when they invoke the prompt.
      </p>
      <PromptsEditor initialPrompts={prompts} />
    </div>
  );
}
