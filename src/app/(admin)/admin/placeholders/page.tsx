import { requireSession } from "@/lib/auth";
import { PLACEHOLDER_KEYS } from "@/lib/placeholders";

// Z6.2 — placeholder catalog. Sourced from the same PLACEHOLDER_KEYS
// registry expand() uses, so drift between docs and behaviour is
// structurally impossible.

const PLACEHOLDER_DOCS: Record<string, { label: string; example: string }> = {
  "ticket.reference": {
    label: "Ticket reference",
    example: "STRALIS-1234",
  },
  "ticket.title": {
    label: "Ticket title",
    example: "Invoice total doesn't match quote",
  },
  "ticket.priority": {
    label: "Ticket priority (lowercased)",
    example: "urgent",
  },
  "ticket.status": {
    label: "Ticket status (lowercased, human-readable)",
    example: "in progress",
  },
  "ticket.requester.name": {
    label: "Requester name",
    example: "Priya Shah",
  },
  "ticket.requester.email": {
    label: "Requester email",
    example: "priya@acmecorp.com",
  },
  "ticket.organization.name": {
    label: "Organization name",
    example: "Acme Corporation",
  },
  "agent.name": {
    label: "Acting agent's name",
    example: "Jordan Reyes",
  },
  "agent.email": {
    label: "Acting agent's email",
    example: "jordan@stralis.app",
  },
  "tenant.productName": {
    label: "Product name (from branding)",
    example: "solvr",
  },
};

export default async function PlaceholdersPage() {
  await requireSession({ minRole: "AGENT" });
  return (
    <div>
      <h1 className="text-2xl font-bold mb-2">Placeholders</h1>
      <p className="text-[13px] text-[var(--color-neutral-500)] mb-6 max-w-2xl">
        Placeholders resolve to live values when a canned response, macro, or
        email template renders. Unknown or empty values become blanks — a
        broken template never leaks the raw <code className="font-mono">{"{{token}}"}</code> into
        a customer message.
      </p>
      <div className="bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-[var(--color-light-gray)] text-[11px] uppercase-label text-[var(--color-neutral-700)]">
            <tr>
              <th className="text-left font-semibold px-4 py-2.5 w-1/3">Token</th>
              <th className="text-left font-semibold px-4 py-2.5">Meaning</th>
              <th className="text-left font-semibold px-4 py-2.5">Example</th>
            </tr>
          </thead>
          <tbody>
            {PLACEHOLDER_KEYS.map((key) => {
              const doc = PLACEHOLDER_DOCS[key];
              return (
                <tr
                  key={key}
                  className="border-t border-[var(--color-neutral-100)]"
                >
                  <td className="px-4 py-3">
                    <code className="font-mono text-[12px] bg-[var(--color-neutral-100)] dark:bg-white/[0.06] px-2 py-1 rounded">
                      {`{{${key}}}`}
                    </code>
                  </td>
                  <td className="px-4 py-3 text-[13px]">{doc?.label ?? key}</td>
                  <td className="px-4 py-3 text-[12px] text-[var(--color-neutral-600)] font-mono">
                    {doc?.example ?? "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-[12px] text-[var(--color-neutral-500)] mt-4">
        Ticket internal IDs are deliberately not exposed —{" "}
        <code className="font-mono">{`{{ticket.reference}}`}</code> is the public identifier.
      </p>
    </div>
  );
}
