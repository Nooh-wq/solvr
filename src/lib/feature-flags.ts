// Phase 4c — Feature flag catalog. Values on Tenant.featureFlags (JSON
// blob keyed by these `key`s) are consulted at runtime by callers via
// `isFeatureEnabled(tenantId, key)`. Unknown keys default to `false`.
//
// Kept dep-free so it can be imported anywhere (server actions, cron
// jobs, page components). The Super Admin editor at
// /admin/super/flags is the only writer.

export type FeatureFlagKey =
  | "experimental_semantic_search"
  | "beta_voice_channel"
  | "beta_ai_composer"
  | "beta_workflow_builder"
  | "internal_debug_panel"
  | "legacy_ticket_layout";

export type FeatureFlagDef = {
  key: FeatureFlagKey;
  label: string;
  description: string;
  category: "beta" | "experimental" | "internal" | "legacy";
  default: boolean;
};

export const FEATURE_FLAGS: FeatureFlagDef[] = [
  {
    key: "experimental_semantic_search",
    label: "Semantic ticket search",
    description: "Embedding-based ranking on the global search bar. Costs more per query.",
    category: "experimental",
    default: false,
  },
  {
    key: "beta_voice_channel",
    label: "Voice channel (beta)",
    description: "Enables the Voice channel configuration under Channels → Voice.",
    category: "beta",
    default: false,
  },
  {
    key: "beta_ai_composer",
    label: "AI reply composer",
    description: "Adds a Draft with AI button to the agent reply composer.",
    category: "beta",
    default: false,
  },
  {
    key: "beta_workflow_builder",
    label: "Visual workflow builder",
    description: "Drag-and-drop rule builder replacing the trigger/automation editors.",
    category: "beta",
    default: false,
  },
  {
    key: "internal_debug_panel",
    label: "Debug panel (internal)",
    description: "Adds a floating panel on ticket detail showing raw event and rule logs.",
    category: "internal",
    default: false,
  },
  {
    key: "legacy_ticket_layout",
    label: "Legacy ticket layout",
    description: "Keeps the pre-2025 ticket detail rail. Deprecated — will be removed.",
    category: "legacy",
    default: false,
  },
];

export function isFlagEnabled(featureFlags: unknown, key: FeatureFlagKey): boolean {
  const def = FEATURE_FLAGS.find((f) => f.key === key);
  const base = def?.default ?? false;
  if (typeof featureFlags !== "object" || featureFlags === null) return base;
  const val = (featureFlags as Record<string, unknown>)[key];
  return typeof val === "boolean" ? val : base;
}
