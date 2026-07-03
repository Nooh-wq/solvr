import { ClaudeProvider } from "./claude-provider";
import { OpenRouterProvider } from "./openrouter-provider";
import { UnconfiguredAiProvider, type AiProvider } from "./provider";

// Prefers OpenRouter when both are set — it's the free option, so it's the
// one you'd be actively testing with. Swap the order (or unset one key) to
// change precedence; only one provider is ever instantiated.
function selectProvider(): AiProvider {
  if (process.env.OPENROUTER_API_KEY) {
    return new OpenRouterProvider(process.env.OPENROUTER_API_KEY, process.env.OPENROUTER_MODEL);
  }
  if (process.env.ANTHROPIC_API_KEY) {
    return new ClaudeProvider(process.env.ANTHROPIC_API_KEY);
  }
  return new UnconfiguredAiProvider();
}

export const aiProvider: AiProvider = selectProvider();

export * from "./provider";
