// Provider boundary (build spec §B-6 / TRD §6.4): keeps the concrete LLM
// swappable and testable. All AI calls are server-only — never import this
// into a client component.

export type ChatTurn = { role: "user" | "assistant"; content: string };

export type GenerateInput = {
  systemPrompt: string;
  turns: ChatTurn[];
};

// M9 — the classification surface.
//
// Every inbound message goes through classifyMessage(). The provider
// returns four signals + a scalar confidence + the raw token cost so
// per-tenant budget enforcement (M9 §3) has real numbers to work with.
//
// intent is bounded to `intentSlugs` — the classification prompt is
// generated with the tenant's IntentTaxonomy embedded, so the model
// cannot invent an intent that admins haven't declared. On no match,
// intent is null and confidence reflects that uncertainty.

export type ClassifySignals = {
  intent: string | null;
  sentiment: "positive" | "neutral" | "negative" | "frustrated" | "angry" | null;
  urgency: "low" | "medium" | "high" | "critical" | null;
  language: string | null; // BCP-47
  confidence: number; // 0.0–1.0 aggregate
  tokensUsed: number;
};

export type ClassifyInput = {
  body: string;
  intents: Array<{ slug: string; label: string; description: string }>;
};

// M10 — self-learning KB. The clustering job passes a set of
// resolved-ticket digests (title + agent-visible resolution excerpt,
// PII-redacted) and asks the model to draft ONE unified article
// grounded in the pattern across them. Return payload is small enough
// to stream — title + body + tokensUsed for budget accounting.
export type DraftKbInput = {
  // Human-language topic hint distilled from the cluster's most common
  // terms — e.g. "Reset printer PIN". Used as a nudge, not authoritative.
  topicHint: string;
  // Anonymised, agent-facing excerpts of each ticket's resolution. Order
  // matches sourceTicketIds so citations line up. Never includes
  // internal notes (§3) — the clustering pipeline filters those out
  // before calling this.
  resolutions: Array<{ ticketReference: string; excerpt: string }>;
};

export type KbDraft = {
  title: string;
  body: string;
  tokensUsed: number;
};

export interface AiProvider {
  /** True when the provider has real credentials — callers use this to degrade gracefully instead of erroring. */
  readonly isConfigured: boolean;
  generate(input: GenerateInput): Promise<string>;
  summarizeTicket(thread: string): Promise<string>;
  suggestReply(thread: string, kbContext: string): Promise<string>;
  suggestTriage(title: string, description: string): Promise<{ category: string | null; priority: "LOW" | "MEDIUM" | "HIGH" | "URGENT" }>;
  /**
   * M9 — enrich a customer / guest message with AI-derived signals.
   * Returns raw provider tokens so per-tenant budget tracking has a
   * source-of-truth number. On failure, throws — the Inngest classify
   * function catches and stores nothing, keeping the "signals not yet
   * available" UI path for both errors and pending states.
   */
  classifyMessage(input: ClassifyInput): Promise<ClassifySignals>;
  /**
   * M9.7 — translate `body` from `sourceLang` (BCP-47 or null for auto-
   * detect) into `targetLang`. Returns null if the source is already the
   * target, or the target isn't a language the provider handles.
   */
  translate(body: string, sourceLang: string | null, targetLang: string): Promise<{ text: string; tokensUsed: number } | null>;
  /**
   * M10 — draft a KB article from a cluster of resolved-ticket
   * resolutions. Never invents facts outside the excerpts. Returns
   * tokensUsed for tenant budget accounting. On failure, throws — the
   * nightly cron catches and simply files no suggestion for that cluster.
   */
  draftKbArticle(input: DraftKbInput): Promise<KbDraft>;
}

/** No-op provider used when ANTHROPIC_API_KEY isn't set — every method throws NOT_CONFIGURED so call sites can catch and degrade (mirrors the email provider's pattern). */
export class UnconfiguredAiProvider implements AiProvider {
  readonly isConfigured = false;
  async generate(): Promise<string> {
    throw new Error("NOT_CONFIGURED");
  }
  async summarizeTicket(): Promise<string> {
    throw new Error("NOT_CONFIGURED");
  }
  async suggestReply(): Promise<string> {
    throw new Error("NOT_CONFIGURED");
  }
  async suggestTriage(): Promise<{ category: string | null; priority: "LOW" | "MEDIUM" | "HIGH" | "URGENT" }> {
    throw new Error("NOT_CONFIGURED");
  }
  async classifyMessage(_input: ClassifyInput): Promise<ClassifySignals> {
    void _input;
    throw new Error("NOT_CONFIGURED");
  }
  async translate(
    _body: string,
    _sourceLang: string | null,
    _targetLang: string
  ): Promise<{ text: string; tokensUsed: number } | null> {
    void _body;
    void _sourceLang;
    void _targetLang;
    throw new Error("NOT_CONFIGURED");
  }
  async draftKbArticle(_input: DraftKbInput): Promise<KbDraft> {
    void _input;
    throw new Error("NOT_CONFIGURED");
  }
}
