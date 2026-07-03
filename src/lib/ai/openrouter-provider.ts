import type { AiProvider, GenerateInput } from "./provider";

const DEFAULT_MODEL = "nvidia/nemotron-3-ultra-550b-a55b:free";
const API_URL = "https://openrouter.ai/api/v1/chat/completions";

// OpenRouter's API is OpenAI-compatible: POST chat/completions with an
// Authorization bearer token. HTTP-Referer/X-Title are optional but
// OpenRouter uses them for their public model-ranking pages.
export class OpenRouterProvider implements AiProvider {
  readonly isConfigured = true;
  private apiKey: string;
  private model: string;

  constructor(apiKey: string, model: string = DEFAULT_MODEL) {
    this.apiKey = apiKey;
    this.model = model;
  }

  async generate(input: GenerateInput): Promise<string> {
    const response = await fetch(API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000",
        "X-Title": "Stralis Ticketing System",
      },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: "system", content: input.systemPrompt },
          ...input.turns.map((t) => ({ role: t.role, content: t.content })),
        ],
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`OpenRouter request failed (${response.status}): ${body.slice(0, 300)}`);
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content ?? "";
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
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : text.trim());
      return { category: parsed.category ?? null, priority: parsed.priority ?? "MEDIUM" };
    } catch {
      return { category: null, priority: "MEDIUM" };
    }
  }
}
