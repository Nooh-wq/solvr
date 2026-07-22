"use client";

import { useState } from "react";

export function EmbedSnippet({ portalUrl }: { portalUrl: string }) {
  const [copied, setCopied] = useState(false);
  const snippet = `<iframe
  src="${portalUrl}"
  width="100%"
  height="720"
  frameborder="0"
  style="border: 1px solid #e5e5e5; border-radius: 12px;"
  title="Submit a ticket"
></iframe>`;

  function copy() {
    navigator.clipboard.writeText(snippet).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div>
      <pre className="text-[11px] font-mono p-3 rounded bg-[var(--color-neutral-100)] overflow-x-auto whitespace-pre">
        {snippet}
      </pre>
      <button
        type="button"
        onClick={copy}
        className="mt-2 text-[12px] font-medium px-3 py-1.5 rounded-lg border border-[var(--color-neutral-300)] hover:bg-[var(--color-neutral-100)] cursor-pointer"
      >
        {copied ? "Copied!" : "Copy embed code"}
      </button>
    </div>
  );
}
