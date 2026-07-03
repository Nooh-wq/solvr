import { listKbArticles } from "@/actions/kb";
import { KbManager } from "./kb-manager";

export default async function KbPage() {
  const articles = await listKbArticles();
  return (
    <div>
      <h1 className="text-2xl font-bold mb-1">Knowledge base</h1>
      <p className="text-sm text-[var(--color-neutral-600)] mb-6">
        Published articles ground the client chatbot and the agent copilot — see the AI copilot panel on any
        ticket, and the chat widget in the client portal.
      </p>
      <KbManager
        articles={articles.map((a) => ({
          id: a.id,
          title: a.title,
          body: a.body,
          isPublished: a.isPublished,
          updatedAt: a.updatedAt.toISOString(),
        }))}
      />
    </div>
  );
}
