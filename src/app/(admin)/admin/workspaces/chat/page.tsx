import { getChatbotConfig } from "@/actions/workspaceSettings";
import { ChatbotEditor } from "./chatbot-editor";

export const dynamic = "force-dynamic";

export default async function ChatWidgetPage() {
  const config = await getChatbotConfig();
  return (
    <div>
      <h1 className="text-2xl font-bold mb-1">Chat widget</h1>
      <p className="text-sm text-[var(--color-neutral-600)] mb-6 max-w-2xl">
        The AI-powered chat widget on the customer portal. Configure the persona, when to
        deflect vs. escalate to a human, and topic guardrails.
      </p>
      <ChatbotEditor initialConfig={config} />
    </div>
  );
}
