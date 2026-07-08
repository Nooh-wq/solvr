"use server";

// Z3.6 — bulk CSV export + import for the Customers page. Same
// { succeeded, failed } contract as M21's team bulk actions so the
// existing summarize() UI can render per-row failures directly.
//
// Import contract:
//   * Header row REQUIRED. Recognized columns (case-insensitive):
//     email (required), name, organization, tags (comma-separated).
//   * One row per end user. Duplicate emails within the tenant are
//     rejected as per-row failures (`failed[]`), never silently upserted.
//   * `organization` matches an existing Organization by name. If none,
//     falls back to email-domain auto-match via the existing
//     matchCompanyByEmail helper (personal-mail domains excluded there).

import { revalidatePath } from "next/cache";
import crypto from "node:crypto";
import { z } from "zod";
import { withRls } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { systemContext, createEndUser, matchEndUserByEmail } from "@/lib/shared-platform";
import { matchCompanyByEmail } from "@/lib/company-match";
import { dualFkForUser, actorCols } from "@/lib/z1-dual-fk";

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export async function exportCustomersCsv(): Promise<
  { ok: true; csv: string; filename: string } | { ok: false; error: string }
> {
  const session = await requireSession({ minRole: "ADMIN" });
  const ctx = systemContext(session.tenantId);

  const { listCustomers } = await import("./people");
  const rows = await listCustomers();
  if (rows.length === 0) return { ok: false, error: "No customers to export." };
  void ctx; // ctx unused here — reserved for a future paged wrapper import.

  const escape = (v: string | null | undefined) => {
    if (v == null) return "";
    return `"${String(v).replace(/"/g, '""')}"`;
  };
  const header = [
    "Email",
    "Name",
    "Organization",
    "Tags",
    "Status",
    "Ticket count",
    "CSAT avg",
    "Last active",
  ];
  const lines = [
    header.map(escape).join(","),
    ...rows.map((r) =>
      [
        r.email,
        r.name,
        r.organizationName,
        r.tags.map((t) => t.name).join(", "),
        r.status,
        String(r.ticketCount),
        r.csatAvg === null ? "" : r.csatAvg.toFixed(2),
        r.lastActiveAt ? r.lastActiveAt.toISOString() : "",
      ]
        .map(escape)
        .join(",")
    ),
  ];
  const csv = lines.join("\r\n") + "\r\n";
  const stamp = new Date().toISOString().slice(0, 10);
  return { ok: true, csv, filename: `customers-${stamp}.csv` };
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

const importInputSchema = z.object({
  csv: z.string().min(1).max(2_000_000),
});

export type CustomerImportResult = {
  succeeded: Array<{ email: string; id: string }>;
  failed: Array<{ email: string; reason: string; row: number }>;
};

export async function importCustomersCsv(
  input: z.infer<typeof importInputSchema>
): Promise<CustomerImportResult | { ok: false; error: string }> {
  const session = await requireSession({ minRole: "ADMIN" });
  const parsed = importInputSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };

  const parsedRows = parseCsv(parsed.data.csv);
  if (parsedRows.length === 0) {
    return { ok: false, error: "CSV is empty or has no header row." };
  }

  // Header inspection — case-insensitive column mapping. Row 1 (0-indexed)
  // is the header itself; data rows start at 2 for user-facing row numbers.
  const headers = parsedRows[0].map((h) => h.trim().toLowerCase());
  const col = (name: string) => headers.indexOf(name);
  const emailIdx = col("email");
  if (emailIdx === -1)
    return { ok: false, error: "CSV must have an 'email' column." };
  const nameIdx = col("name");
  const orgIdx = col("organization");
  const tagsIdx = col("tags");

  const ctx = systemContext(session.tenantId);
  const succeeded: CustomerImportResult["succeeded"] = [];
  const failed: CustomerImportResult["failed"] = [];

  // Pre-load org name → id so we don't hit the DB N times for the "find
  // Acme Corp" lookup during a large import.
  const orgByName = await withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    async (tx) => {
      const orgs = await tx.organization.findMany({
        where: { tenantId: session.tenantId },
        select: { id: true, name: true },
      });
      return new Map(orgs.map((o) => [o.name.toLowerCase(), o.id]));
    }
  );

  for (let i = 1; i < parsedRows.length; i++) {
    const row = parsedRows[i];
    const displayRowNum = i + 1;
    const rawEmail = (row[emailIdx] ?? "").trim();
    if (rawEmail === "") continue; // silently skip blank rows
    const email = rawEmail.toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      failed.push({ email: rawEmail, reason: "Invalid email format.", row: displayRowNum });
      continue;
    }

    try {
      // Duplicate check — wrapper's uniqueness catches this too via P2002,
      // but doing it up-front lets us return a clean failure message.
      const existing = await matchEndUserByEmail(ctx, email);
      if (existing) {
        failed.push({
          email,
          reason: "An account with this email already exists.",
          row: displayRowNum,
        });
        continue;
      }

      // Org resolution: named match wins, else fall back to email-domain
      // auto-match (mirrors the singular inviteUser() behaviour).
      let organizationId: string | null = null;
      const orgName = orgIdx >= 0 ? (row[orgIdx] ?? "").trim() : "";
      if (orgName !== "") {
        organizationId = orgByName.get(orgName.toLowerCase()) ?? null;
      }
      if (!organizationId) {
        organizationId = await matchCompanyByEmail(session.tenantId, email);
      }

      const subjectId = crypto.randomUUID();
      const name = nameIdx >= 0 ? (row[nameIdx] ?? "").trim() || null : null;
      await createEndUser(ctx, {
        id: subjectId,
        email,
        name,
        organizationId,
      });
      await withRls(
        { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
        async (tx) => {
          // Bare-minimum lifecycle so the customer shows up as ACTIVE
          // without needing an invite email. No AuthCredential — imported
          // customers can't log in until an admin explicitly invites them.
          await tx.endUserLifecycle.upsert({
            where: { subjectId },
            create: {
              subjectId,
              tenantId: session.tenantId,
              status: "ACTIVE",
            },
            update: {},
          });
          await tx.auditLog.create({
            data: {
              tenantId: session.tenantId,
              ...actorCols(dualFkForUser(session.subjectId, session.role)),
              action: "IMPORT_CUSTOMER",
              toValue: email,
            },
          });
        }
      );
      // Tag application deferred — tag rows are wrapper-owned and would
      // need one createOrReuse + one tagAssignment call per tag per row.
      // Recording the column here so a future pass can wire it up
      // without changing the import contract.
      void tagsIdx;
      succeeded.push({ email, id: subjectId });
    } catch (e) {
      const reason = e instanceof Error ? e.message : "Unknown error.";
      failed.push({ email, reason, row: displayRowNum });
    }
  }

  revalidatePath("/admin/customers");
  return { succeeded, failed };
}

// ---------------------------------------------------------------------------
// Minimal RFC-4180 CSV parser. Handles quoted fields, doubled quotes,
// CR/LF/CRLF row terminators. Enough for the shapes the Customers page
// imports/exports; a full spec parser is out of scope.
// ---------------------------------------------------------------------------

function parseCsv(source: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let i = 0;
  let inQuotes = false;
  const s = source;

  while (i < s.length) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (c === ",") {
      row.push(field);
      field = "";
      i++;
      continue;
    }
    if (c === "\r" || c === "\n") {
      row.push(field);
      field = "";
      // Skip CRLF as one terminator.
      if (c === "\r" && s[i + 1] === "\n") i++;
      i++;
      if (row.some((v) => v !== "")) rows.push(row);
      row = [];
      continue;
    }
    field += c;
    i++;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    if (row.some((v) => v !== "")) rows.push(row);
  }
  return rows;
}
