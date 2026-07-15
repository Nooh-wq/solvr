// M19.3 — GitHub integration. Personal-access-token auth; creates an
// issue in a fixed owner/repo. Same reasoning as jira.ts for
// preferring API-token over full OAuth: paste-installable, no platform
// app registration required upfront.

import type { Integration, IntegrationContext, ExecuteResult } from "./types";

async function ghFetch(
  token: string,
  path: string,
  init?: RequestInit
): Promise<{ ok: boolean; status: number; body: unknown }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(`https://api.github.com${path}`, {
      ...init,
      headers: {
        ...(init?.headers ?? {}),
        authorization: `Bearer ${token}`,
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
        "user-agent": "solvr-integration",
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

export const githubIntegration: Integration = {
  key: "github",
  name: "GitHub",
  tagline: "File GitHub issues from Solvr tickets.",
  category: "Developer",
  authMode: "api_key",
  credentialFields: [
    {
      key: "token",
      label: "GitHub personal access token",
      helpText:
        "Fine-grained PAT with 'Issues: Read and write' on the target repo. Classic PATs with 'repo' scope also work.",
      isSecret: true,
    },
  ],
  metaFields: [
    { key: "owner", label: "Repo owner", helpText: "GitHub user or org login.", placeholder: "acme" },
    { key: "repo", label: "Repo name", placeholder: "web-app" },
  ],

  async test(ctx: IntegrationContext) {
    const token = ctx.credentials.token;
    if (!token) return { ok: false, message: "Missing token." };
    const me = await ghFetch(token, "/user");
    if (!me.ok) return { ok: false, message: `GitHub responded ${me.status}` };
    const owner = typeof ctx.meta.owner === "string" ? ctx.meta.owner : "";
    const repo = typeof ctx.meta.repo === "string" ? ctx.meta.repo : "";
    if (owner && repo) {
      const r = await ghFetch(token, `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`);
      if (!r.ok) return { ok: false, message: `Repo ${owner}/${repo} not reachable (${r.status})` };
    }
    return { ok: true };
  },

  async execute(ctx, args): Promise<ExecuteResult> {
    const token = ctx.credentials.token;
    if (!token) throw new Error("GitHub integration is missing its token.");
    const owner = typeof ctx.meta.owner === "string" ? ctx.meta.owner : "";
    const repo = typeof ctx.meta.repo === "string" ? ctx.meta.repo : "";
    if (!owner || !repo) throw new Error("GitHub integration has no owner/repo configured.");
    const body = `${args.ticket.description}\n\nLinked from Solvr: ${args.ticket.url}${
      args.note ? `\n\n${args.note}` : ""
    }`;
    const res = await ghFetch(token, `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues`, {
      method: "POST",
      body: JSON.stringify({
        title: `[${args.ticket.reference}] ${args.ticket.subject}`.slice(0, 200),
        body,
      }),
    });
    if (!res.ok) throw new Error(`GitHub create failed (${res.status}): ${JSON.stringify(res.body).slice(0, 160)}`);
    const issue = res.body as { number?: number; html_url?: string; title?: string } | null;
    if (!issue?.number || !issue?.html_url) throw new Error("GitHub response missing issue number/url.");
    return {
      externalKey: `${owner}/${repo}#${issue.number}`,
      externalUrl: issue.html_url,
      externalTitle: issue.title ?? args.ticket.subject,
    };
  },
};
