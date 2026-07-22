// M19.3 — Jira integration. Uses Atlassian's basic-auth REST API
// (email + API token) to create an issue in a fixed project. Full 3LO
// OAuth would require an Atlassian Cloud app registration on the
// platform side; API tokens are per-user and paste-installable, which
// matches the "listed = installable" pin (spec §3).
//
// One TenantIntegration row = one Jira project. Installing a second
// project is a second install of the same catalog entry (the
// (tenantId, appKey, displayName) unique key on TenantIntegration
// allows this).

import type { Integration, IntegrationContext, ExecuteResult } from "./types";

function jiraAuthHeader(email: string, token: string): string {
  return "Basic " + Buffer.from(`${email}:${token}`).toString("base64");
}

async function jiraFetch(
  baseUrl: string,
  path: string,
  auth: string,
  init?: RequestInit
): Promise<{ ok: boolean; status: number; body: unknown }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, "")}${path}`, {
      ...init,
      headers: {
        ...(init?.headers ?? {}),
        authorization: auth,
        accept: "application/json",
        "content-type": "application/json",
      },
      signal: controller.signal,
    });
    const text = await res.text();
    let body: unknown = text;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      /* keep as text */
    }
    return { ok: res.ok, status: res.status, body };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Jira's create-issue API needs "description" as an Atlassian Document
 * Format (ADF) doc, not plain text. Minimal ADF wrapper — one paragraph.
 */
function adfDoc(text: string) {
  return {
    version: 1,
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [{ type: "text", text }],
      },
    ],
  };
}

export const jiraIntegration: Integration = {
  key: "jira",
  name: "Jira",
  tagline: "Create linked Jira issues from Solvr tickets.",
  category: "Developer",
  authMode: "api_key",
  credentialFields: [
    {
      key: "baseUrl",
      label: "Jira Cloud base URL",
      helpText: "e.g. https://acme.atlassian.net",
      isSecret: false,
    },
    { key: "email", label: "Atlassian account email", isSecret: false },
    {
      key: "apiToken",
      label: "Atlassian API token",
      helpText: "id.atlassian.com → Security → API tokens.",
      isSecret: true,
    },
  ],
  metaFields: [
    {
      key: "projectKey",
      label: "Project key",
      helpText: "Short project key, e.g. ENG. Every created issue lands here.",
      placeholder: "ENG",
    },
    {
      key: "issueType",
      label: "Issue type",
      helpText: "Defaults to Task if left blank.",
      placeholder: "Task",
    },
  ],

  async test(ctx: IntegrationContext) {
    const { baseUrl, email, apiToken } = ctx.credentials;
    if (!baseUrl || !email || !apiToken) return { ok: false, message: "Missing credentials." };
    const res = await jiraFetch(baseUrl, "/rest/api/3/myself", jiraAuthHeader(email, apiToken));
    if (!res.ok) return { ok: false, message: `Jira responded ${res.status}` };
    const projectKey = typeof ctx.meta.projectKey === "string" ? ctx.meta.projectKey : "";
    if (projectKey) {
      const p = await jiraFetch(baseUrl, `/rest/api/3/project/${encodeURIComponent(projectKey)}`, jiraAuthHeader(email, apiToken));
      if (!p.ok) return { ok: false, message: `Project ${projectKey} not found (${p.status})` };
    }
    return { ok: true };
  },

  async execute(ctx, args): Promise<ExecuteResult> {
    const { baseUrl, email, apiToken } = ctx.credentials;
    if (!baseUrl || !email || !apiToken) throw new Error("Jira integration is missing credentials.");
    const projectKey = typeof ctx.meta.projectKey === "string" ? ctx.meta.projectKey : "";
    if (!projectKey) throw new Error("Jira integration has no project key configured.");
    const issueType = (typeof ctx.meta.issueType === "string" && ctx.meta.issueType) || "Task";
    const desc = `${args.ticket.description}\n\nLinked from Solvr: ${args.ticket.url}${
      args.note ? `\n\n${args.note}` : ""
    }`;
    const res = await jiraFetch(baseUrl, "/rest/api/3/issue", jiraAuthHeader(email, apiToken), {
      method: "POST",
      body: JSON.stringify({
        fields: {
          project: { key: projectKey },
          summary: `[${args.ticket.reference}] ${args.ticket.subject}`.slice(0, 250),
          description: adfDoc(desc),
          issuetype: { name: issueType },
        },
      }),
    });
    if (!res.ok) throw new Error(`Jira create failed (${res.status}): ${JSON.stringify(res.body).slice(0, 160)}`);
    const body = res.body as { key?: string; self?: string } | null;
    const key = body?.key;
    if (!key) throw new Error("Jira response missing issue key.");
    return {
      externalKey: key,
      externalUrl: `${baseUrl.replace(/\/$/, "")}/browse/${encodeURIComponent(key)}`,
      externalTitle: args.ticket.subject,
    };
  },
};
