// M7.5 — hand-written docs page for /api/v1. Uses a Redoc-style
// server-rendered layout (no external CDN — the OpenAPI spec is the
// truth, this page is a rendered index that developers can browse).
//
// This is intentionally not a Swagger UI clone — for that use case the
// developer can point their own editor at /api/v1/openapi.json.

import { headers } from "next/headers";

async function fetchSpec(): Promise<Record<string, unknown>> {
  const h = await headers();
  const host = h.get("host") ?? "localhost:3000";
  const proto = host.startsWith("localhost") ? "http" : "https";
  const res = await fetch(`${proto}://${host}/api/v1/openapi.json`, { cache: "no-store" });
  return res.json();
}

type OpMethod = "get" | "post" | "patch" | "put" | "delete";
type OperationObject = { summary?: string; description?: string };

export default async function ApiDocsPage() {
  const spec = await fetchSpec();
  const info = spec.info as { title: string; version: string; description?: string };
  const paths = spec.paths as Record<string, Record<string, OperationObject>>;

  return (
    <main className="min-h-screen p-6 md:p-12 max-w-4xl mx-auto">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-1">{info.title}</h1>
        <p className="text-[13px] text-[var(--color-neutral-500)]">Version {info.version}</p>
        {info.description && (
          <p className="text-[14px] mt-3 text-[var(--color-neutral-700)]">{info.description}</p>
        )}
      </div>

      <div className="mb-8 bg-[var(--color-surface-muted)] rounded-lg p-4 border border-[var(--color-neutral-200)]">
        <h2 className="text-[15px] font-semibold mb-2">Machine-readable spec</h2>
        <p className="text-[13px] text-[var(--color-neutral-700)]">
          The full OpenAPI 3.1 document is at{" "}
          <a href="/api/v1/openapi.json" className="underline font-mono">/api/v1/openapi.json</a>.
          Point any OpenAPI-compatible client / editor at that URL.
        </p>
      </div>

      <div className="mb-8 bg-[var(--color-surface-muted)] rounded-lg p-4 border border-[var(--color-neutral-200)]">
        <h2 className="text-[15px] font-semibold mb-2">Authentication</h2>
        <p className="text-[13px] text-[var(--color-neutral-700)] mb-2">
          Every request needs a bearer API key:
        </p>
        <pre className="bg-[var(--color-surface)] p-3 rounded font-mono text-[12px] overflow-x-auto">
Authorization: Bearer stralis_pk_...</pre>
        <p className="text-[13px] text-[var(--color-neutral-700)] mt-2">
          Create keys in Apps → API keys. Each key carries a set of scopes
          bounded by the creator&apos;s role — a key can never grant more
          permission than the person who made it.
        </p>
      </div>

      <div className="mb-8 bg-[var(--color-surface-muted)] rounded-lg p-4 border border-[var(--color-neutral-200)]">
        <h2 className="text-[15px] font-semibold mb-2">Rate limits</h2>
        <p className="text-[13px] text-[var(--color-neutral-700)]">
          300 requests / 10s per tenant. Additional keys don&apos;t raise the
          limit — it&apos;s tenant-wide.
        </p>
      </div>

      <h2 className="text-[18px] font-bold mb-4">Endpoints</h2>
      <div className="space-y-4">
        {Object.entries(paths).map(([path, ops]) => (
          <div key={path} className="bg-[var(--color-surface)] rounded-lg p-4 border border-[var(--color-neutral-200)]">
            <h3 className="font-mono text-[14px] font-semibold mb-2">{path}</h3>
            <ul className="space-y-1">
              {(["get", "post", "patch", "put", "delete"] as OpMethod[]).map((m) => {
                const op = ops[m];
                if (!op || typeof op !== "object" || Array.isArray(op)) return null;
                return (
                  <li key={m} className="flex items-start gap-2 text-[13px]">
                    <span className="uppercase font-mono font-semibold text-[11px] px-2 py-0.5 rounded bg-[var(--color-neutral-200)] dark:bg-white/10 min-w-[52px] text-center">
                      {m}
                    </span>
                    <span>{op.summary ?? "(no summary)"}</span>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </main>
  );
}
