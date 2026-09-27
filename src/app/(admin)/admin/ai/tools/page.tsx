import { listAiTools } from "@/actions/aiTools";
import { ToolsForm } from "./tools-form";

export default async function AiToolsPage() {
  const tools = await listAiTools();
  return (
    <div>
      <h1 className="text-2xl font-bold mb-1">AI tools</h1>
      <p className="text-sm text-[var(--color-neutral-600)] mb-6">
        The tool registry the agentic AI can propose calls to. Each tool is validated against its argument schema and
        role allow-list before running. Sensitive tools require human approval before execution.
      </p>
      <ToolsForm tools={tools} />
    </div>
  );
}
