import type { AiProvider, GenerateInput, ClassifyInput, ClassifySignals, DraftKbInput, KbDraft } from "./provider";

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

  async classifyMessage(input: ClassifyInput): Promise<ClassifySignals> {
    const taxonomy = input.intents
      .map((i) => `  - ${i.slug} — ${i.label}: ${i.description}`)
      .join("\n");
    const allowedIntents = input.intents.length > 0
      ? input.intents.map((i) => `"${i.slug}"`).join(" | ")
      : "null";
    const systemPrompt =
      "You classify a single inbound customer support message into structured signals. " +
      "Respond with EXACTLY one line of JSON, nothing else:\n" +
      `{"intent": ${allowedIntents} | null, ` +
      `"sentiment": "positive" | "neutral" | "negative" | "frustrated" | "angry", ` +
      `"urgency": "low" | "medium" | "high" | "critical", ` +
      `"language": "<BCP-47 tag like 'en' or 'es-419'>", ` +
      `"confidence": <0.0..1.0 aggregate over all four dimensions>}\n\n` +
      (taxonomy
        ? `Allowed intents (choose one or null if none fit):\n${taxonomy}`
        : "This tenant has no intent taxonomy configured — return intent: null.");

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
          { role: "system", content: systemPrompt },
          { role: "user", content: input.body },
        ],
        max_tokens: 200,
      }),
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`OpenRouter classify failed (${response.status}): ${body.slice(0, 300)}`);
    }
    const data = await response.json();
    const text = data.choices?.[0]?.message?.content ?? "";
    const tokensUsed = (data.usage?.prompt_tokens ?? 0) + (data.usage?.completion_tokens ?? 0);
    try {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : text.trim());
      return {
        intent: parsed.intent ?? null,
        sentiment: parsed.sentiment ?? null,
        urgency: parsed.urgency ?? null,
        language: parsed.language ?? null,
        confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0,
        tokensUsed,
      };
    } catch {
      return { intent: null, sentiment: null, urgency: null, language: null, confidence: 0, tokensUsed };
    }
  }

  async translate(
    body: string,
    sourceLang: string | null,
    targetLang: string
  ): Promise<{ text: string; tokensUsed: number } | null> {
    if (sourceLang === targetLang) return null;
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
          {
            role: "system",
            content:
              `Translate the user's message ${sourceLang ? `from ${sourceLang} ` : ""}into ${targetLang}. ` +
              "Preserve tone and meaning. Output only the translated text — no preamble, no quotes.",
          },
          { role: "user", content: body },
        ],
        max_tokens: 2048,
      }),
    });
    if (!response.ok) return null;
    const data = await response.json();
    const text = (data.choices?.[0]?.message?.content ?? "").trim();
    if (!text) return null;
    return {
      text,
      tokensUsed: (data.usage?.prompt_tokens ?? 0) + (data.usage?.completion_tokens ?? 0),
    };
  }

  async draftKbArticle(input: DraftKbInput): Promise<KbDraft> {
    const resolutionsBlock = input.resolutions
      .map((r, i) => `[${i + 1}] Ticket ${r.ticketReference}:\n${r.excerpt}`)
      .join("\n\n");
    const systemPrompt =
      "You draft a knowledge-base article for a support team, grounded strictly in the provided resolved-ticket " +
      "excerpts. Never invent steps, prices, versions, or policies that the excerpts do not support. If the " +
      "excerpts disagree on details, describe the shared pattern and mark the divergent step as \"varies — " +
      "confirm with the team\". Write plainly and directly, sentence case, short paragraphs, no marketing filler. " +
      "Respond with EXACTLY one JSON object, nothing else: " +
      '{"title": "<concise, sentence case>", "body": "<Markdown, 2-4 short sections>"}';
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
          { role: "system", content: systemPrompt },
          { role: "user", content: `Topic hint: ${input.topicHint}\n\nResolved ticket excerpts:\n\n${resolutionsBlock}` },
        ],
        max_tokens: 1500,
      }),
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`OpenRouter draftKbArticle failed (${response.status}): ${body.slice(0, 300)}`);
    }
    const data = await response.json();
    const text = data.choices?.[0]?.message?.content ?? "";
    const tokensUsed = (data.usage?.prompt_tokens ?? 0) + (data.usage?.completion_tokens ?? 0);
    try {
      const match = text.match(/\{[\s\S]*\}/);
      const parsed = JSON.parse(match ? match[0] : text.trim());
      const title = typeof parsed.title === "string" && parsed.title.trim() ? parsed.title.trim() : input.topicHint;
      const body = typeof parsed.body === "string" && parsed.body.trim() ? parsed.body.trim() : text;
      return { title, body, tokensUsed };
    } catch {
      return { title: input.topicHint, body: text, tokensUsed };
    }
  }
}
