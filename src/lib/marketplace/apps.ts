// M19 — App Marketplace catalog.
//
// Platform-wide (spec §2): every tenant sees the same catalog. To add
// an app, implement the Integration interface elsewhere and register
// it here. Spec §3 pin: "Do NOT show a 'coming soon' integration in
// the marketplace listing" — every entry below is installable.

import type { Integration } from "./types";
import { slackIntegration } from "./slack";
import { jiraIntegration } from "./jira";
import { githubIntegration } from "./github";
import { linearIntegration } from "./linear";

const CATALOG: Integration[] = [
  slackIntegration,
  jiraIntegration,
  githubIntegration,
  linearIntegration,
];

const BY_KEY: Record<string, Integration> = Object.fromEntries(CATALOG.map((a) => [a.key, a]));

export function listMarketplaceApps(): Integration[] {
  return CATALOG;
}

export function getMarketplaceApp(key: string): Integration | null {
  return BY_KEY[key] ?? null;
}
