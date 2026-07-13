import Anthropic from "@anthropic-ai/sdk";
import type { AiProvider, GenerateInput, ClassifyInput, ClassifySignals, DraftKbInput, KbDraft, ToolProposalInput, ToolProposal, QaScoreInput, QaScoreResult } from "./provider";

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

  async classifyMessage(input: ClassifyInput): Promise<ClassifySignals> {
    // Build the taxonomy block for prompt injection. If the tenant has no
    // intents configured, model returns intent=null and we degrade to
    // sentiment/urgency/language only.
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

    const response = await this.client.messages.create({
      model: MODEL,
      max_tokens: 200,
      system: systemPrompt,
      messages: [{ role: "user", content: input.body }],
    });
    const block = response.content.find((b) => b.type === "text");
    const text = block?.type === "text" ? block.text : "";
    const tokensUsed = (response.usage.input_tokens ?? 0) + (response.usage.output_tokens ?? 0);
    try {
      const parsed = JSON.parse(text.trim());
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
    const response = await this.client.messages.create({
      model: MODEL,
      max_tokens: 2048,
      system:
        `Translate the user's message ${sourceLang ? `from ${sourceLang} ` : ""}into ${targetLang}. ` +
        "Preserve tone and meaning. Output only the translated text — no preamble, no quotes.",
      messages: [{ role: "user", content: body }],
    });
    const block = response.content.find((b) => b.type === "text");
    const translated = block?.type === "text" ? block.text.trim() : "";
    if (!translated) return null;
    return {
      text: translated,
      tokensUsed: (response.usage.input_tokens ?? 0) + (response.usage.output_tokens ?? 0),
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
    const response = await this.client.messages.create({
      model: MODEL,
      max_tokens: 1500,
      system: systemPrompt,
      messages: [
        {
          role: "user",
          content: `Topic hint: ${input.topicHint}\n\nResolved ticket excerpts:\n\n${resolutionsBlock}`,
        },
      ],
    });
    const block = response.content.find((b) => b.type === "text");
    const text = block?.type === "text" ? block.text : "";
    const tokensUsed = (response.usage.input_tokens ?? 0) + (response.usage.output_tokens ?? 0);
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

  async proposeToolCall(input: ToolProposalInput): Promise<ToolProposal> {
    const toolsBlock = input.tools
      .map((t) => `  - ${t.name}: ${t.description}\n    args schema: ${JSON.stringify(t.argsSchema)}`)
      .join("\n");
    const toolNames = input.tools.map((t) => `"${t.name}"`).join(" | ");
    const systemPrompt =
      input.systemPrompt +
      "\n\n" +
      "You may propose EXACTLY ONE tool call from the allowed list below, or reply " +
      "in plain text if no tool applies. Never invent a tool name that isn't listed. " +
      "Never propose a tool if the caller hasn't asked for it. When you do propose a " +
      "tool, match its args schema exactly.\n\n" +
      (input.tools.length > 0
        ? `Allowed tools (choose one or none):\n${toolsBlock}\n\n`
        : "No tools available — always reply in plain text.\n\n") +
      "Respond with EXACTLY one JSON object, nothing else:\n" +
      (input.tools.length > 0
        ? `{"tool": ${toolNames} | null, "args": {...}, "reply": "<plain text if no tool>"}\n`
        : `{"tool": null, "args": {}, "reply": "<plain text>"}\n`) +
      'If you use a tool, set "reply" to "".';

    const response = await this.client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system: systemPrompt,
      messages: input.turns.map((t) => ({ role: t.role, content: t.content })),
    });
    const block = response.content.find((b) => b.type === "text");
    const text = block?.type === "text" ? block.text : "";
    const tokensUsed = (response.usage.input_tokens ?? 0) + (response.usage.output_tokens ?? 0);
    return parseToolProposal(text, tokensUsed);
  }

  async scoreReply(input: QaScoreInput): Promise<QaScoreResult> {
    const rubricBlock = input.dimensions
      .map((d) => `  - ${d.key} (${d.label}): ${d.description}`)
      .join("\n");
    const keysUnion = input.dimensions.map((d) => `"${d.key}"`).join(" | ");
    const systemPrompt =
      "You are a support-quality auditor. Score ONE reply against the tenant's rubric. " +
      "Each dimension gets a number 0-5 (0 = totally missing, 5 = excellent) plus a short " +
      "rationale (max 2 sentences). Ground your scoring in what's actually in the reply — " +
      "never invent facts about the reply that aren't there. Respond with EXACTLY one JSON " +
      "object, nothing else:\n" +
      `{"scores": { ${keysUnion}: {"score": 0..5, "rationale": "<short>"}, ... }}\n\n` +
      `Rubric dimensions:\n${rubricBlock}`;

    const response = await this.client.messages.create({
      model: MODEL,
      max_tokens: 1000,
      system: systemPrompt,
      messages: [
        {
          role: "user",
          content: `Thread context:\n${input.threadExcerpt}\n\nReply to score:\n${input.replyBody}`,
        },
      ],
    });
    const block = response.content.find((b) => b.type === "text");
    const text = block?.type === "text" ? block.text : "";
    const tokensUsed = (response.usage.input_tokens ?? 0) + (response.usage.output_tokens ?? 0);
    return parseQaScore(text, input.dimensions, tokensUsed);
  }
}

function parseQaScore(text: string, dims: QaScoreInput["dimensions"], tokensUsed: number): QaScoreResult {
  try {
    const match = text.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(match ? match[0] : text.trim());
    const scores = parsed?.scores;
    if (!scores || typeof scores !== "object") {
      return { dimensions: dims.map((d) => ({ key: d.key, score: 0, rationale: "" })), tokensUsed };
    }
    return {
      dimensions: dims.map((d) => {
        const row = (scores as Record<string, { score?: unknown; rationale?: unknown }>)[d.key];
        const s = typeof row?.score === "number" && row.score >= 0 && row.score <= 5 ? row.score : 0;
        const r = typeof row?.rationale === "string" ? row.rationale.slice(0, 400) : "";
        return { key: d.key, score: s, rationale: r };
      }),
      tokensUsed,
    };
  } catch {
    return { dimensions: dims.map((d) => ({ key: d.key, score: 0, rationale: "" })), tokensUsed };
  }
}

function parseToolProposal(text: string, tokensUsed: number): ToolProposal {
  try {
    const match = text.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(match ? match[0] : text.trim());
    const rawTool = typeof parsed.tool === "string" ? parsed.tool.trim() : null;
    const args =
      parsed.args && typeof parsed.args === "object" && !Array.isArray(parsed.args)
        ? (parsed.args as Record<string, unknown>)
        : {};
    const reply = typeof parsed.reply === "string" ? parsed.reply : "";
    return {
      toolCall: rawTool ? { name: rawTool, args } : null,
      message: reply,
      tokensUsed,
    };
  } catch {
    return { toolCall: null, message: text, tokensUsed };
  }
}
