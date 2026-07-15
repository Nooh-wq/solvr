// M19.3 — Linear integration. Linear only exposes a GraphQL API. API-
// key auth (Linear personal API keys) — see settings → API. One
// TenantIntegration = one team.

import type { Integration, IntegrationContext, ExecuteResult } from "./types";

async function linearFetch(
  apiKey: string,
  query: string,
  variables?: Record<string, unknown>
): Promise<{ ok: boolean; status: number; data: unknown; errors?: unknown }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch("https://api.linear.app/graphql", {
      method: "POST",
      headers: {
        authorization: apiKey,
        "content-type": "application/json",
      },
      body: JSON.stringify({ query, variables }),
      signal: controller.signal,
    });
    const text = await res.text();
    let parsed: { data?: unknown; errors?: unknown } = {};
    try {
      parsed = text ? JSON.parse(text) : {};
    } catch {
      /* empty */
    }
    return { ok: res.ok && !parsed.errors, status: res.status, data: parsed.data, errors: parsed.errors };
  } finally {
    clearTimeout(timeout);
  }
}

export const linearIntegration: Integration = {
  key: "linear",
  name: "Linear",
  tagline: "File Linear issues from Solvr tickets.",
  category: "Developer",
  authMode: "api_key",
  credentialFields: [
    {
      key: "apiKey",
      label: "Linear personal API key",
      helpText: "Linear → Settings → API → Personal API keys.",
      isSecret: true,
    },
  ],
  metaFields: [
    {
      key: "teamId",
      label: "Team ID",
      helpText:
        "Linear team's UUID (Settings → API → the Team you want). Every created issue lands on this team's backlog.",
    },
  ],

  async test(ctx: IntegrationContext) {
    const apiKey = ctx.credentials.apiKey;
    if (!apiKey) return { ok: false, message: "Missing API key." };
    const res = await linearFetch(apiKey, `query { viewer { id name } }`);
    if (!res.ok) return { ok: false, message: `Linear responded ${res.status}` };
    return { ok: true };
  },

  async execute(ctx, args): Promise<ExecuteResult> {
    const apiKey = ctx.credentials.apiKey;
    if (!apiKey) throw new Error("Linear integration is missing its API key.");
    const teamId = typeof ctx.meta.teamId === "string" ? ctx.meta.teamId : "";
    if (!teamId) throw new Error("Linear integration has no teamId configured.");
    const description = `${args.ticket.description}\n\nLinked from Solvr: ${args.ticket.url}${
      args.note ? `\n\n${args.note}` : ""
    }`;
    const res = await linearFetch(
      apiKey,
      `mutation Create($input: IssueCreateInput!) {
        issueCreate(input: $input) {
          success
          issue { id identifier url title }
        }
      }`,
      {
        input: {
          teamId,
          title: `[${args.ticket.reference}] ${args.ticket.subject}`.slice(0, 250),
          description,
        },
      }
    );
    if (!res.ok) throw new Error(`Linear create failed (${res.status}): ${JSON.stringify(res.errors ?? {}).slice(0, 160)}`);
    const data = res.data as { issueCreate?: { success?: boolean; issue?: { identifier?: string; url?: string; title?: string } } } | null;
    const issue = data?.issueCreate?.issue;
    if (!data?.issueCreate?.success || !issue?.identifier || !issue?.url) {
      throw new Error("Linear response missing issue.");
    }
    return {
      externalKey: issue.identifier,
      externalUrl: issue.url,
      externalTitle: issue.title ?? args.ticket.subject,
    };
  },
};
