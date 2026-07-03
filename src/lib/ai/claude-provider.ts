import Anthropic from "@anthropic-ai/sdk";
import type { AiProvider, GenerateInput } from "./provider";

const MODEL = "claude-sonnet-4-5";

export class ClaudeProvider implements AiProvider {
  readonly isConfigured = true;
  private client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  async generate(input: GenerateInput): Promise<string> {
    const response = await this.client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system: input.systemPrompt,
      messages: input.turns.map((t) => ({ role: t.role, content: t.content })),
    });
    const block = response.content.find((b) => b.type === "text");
    return block?.type === "text" ? block.text : "";
  }

  async summarizeTicket(thread: string): Promise<string> {
    return this.generate({
      systemPrompt:
        "You summarize customer support ticket threads for an agent triaging their queue. " +
        "Write 2-3 plain sentences: what the client needs, what's been tried, what's still open. " +
        "No preamble, no headers, sentence case.",
      turns: [{ role: "user", content: thread }],
    });
  }

  async suggestReply(thread: string, kbContext: string): Promise<string> {
    return this.generate({
      systemPrompt:
        "You draft a support agent's reply to a client, grounded only in the provided knowledge-base " +
        "context and the ticket thread. Never invent prices, policies, or commitments the context doesn't " +
        "support — if you're not grounded for something, say the agent should check internally instead. " +
        "Match the brand voice: direct, plain, no filler, sentence case, short sentences. Output only the " +
        "reply text, ready to send — no preamble." +
        (kbContext ? `\n\nKnowledge base context:\n${kbContext}` : "\n\nNo knowledge base context is available."),
      turns: [{ role: "user", content: thread }],
    });
  }

  async suggestTriage(
    title: string,
    description: string
  ): Promise<{ category: string | null; priority: "LOW" | "MEDIUM" | "HIGH" | "URGENT" }> {
    const text = await this.generate({
      systemPrompt:
        "Given a new support ticket's title and description, respond with EXACTLY one line of JSON, " +
        'nothing else: {"category": "Technical" | "Billing" | "General" | "Other", "priority": "LOW" | "MEDIUM" | "HIGH" | "URGENT"}',
      turns: [{ role: "user", content: `Title: ${title}\n\nDescription: ${description}` }],
    });
    try {
      const parsed = JSON.parse(text.trim());
      return { category: parsed.category ?? null, priority: parsed.priority ?? "MEDIUM" };
    } catch {
      return { category: null, priority: "MEDIUM" };
    }
  }
}
