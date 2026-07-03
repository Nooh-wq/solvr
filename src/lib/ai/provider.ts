// Provider boundary (build spec §B-6 / TRD §6.4): keeps the concrete LLM
// swappable and testable. All AI calls are server-only — never import this
// into a client component.

export type ChatTurn = { role: "user" | "assistant"; content: string };

export type GenerateInput = {
  systemPrompt: string;
  turns: ChatTurn[];
};

export interface AiProvider {
  /** True when the provider has real credentials — callers use this to degrade gracefully instead of erroring. */
  readonly isConfigured: boolean;
  generate(input: GenerateInput): Promise<string>;
  summarizeTicket(thread: string): Promise<string>;
  suggestReply(thread: string, kbContext: string): Promise<string>;
  suggestTriage(title: string, description: string): Promise<{ category: string | null; priority: "LOW" | "MEDIUM" | "HIGH" | "URGENT" }>;
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
}
