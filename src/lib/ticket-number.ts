import { Prisma } from "@/generated/prisma";

/** Random 8-digit numeric id, e.g. "12707664" — subject-line-safe, distinct from the tenant-prefixed `reference`. */
function randomTicketNumber() {
  return String(Math.floor(10_000_000 + Math.random() * 90_000_000));
}

/** Random 5-digit number for the human-facing reference, e.g. "48213". */
function randomReferenceDigits() {
  return String(Math.floor(10_000 + Math.random() * 90_000));
}

/**
 * Two-letter prefix derived from the tenant's display name — "Acme Corp" ->
 * "AC", "solvr" -> "SO". Keeps each white-label tenant's ticket references
 * looking like their own (not the host platform's), per-tenant, without
 * requiring admins to configure it.
 */
export function initialsOf(tenantName: string): string {
  const words = tenantName.trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  const letters = tenantName.replace(/[^a-zA-Z]/g, "");
  return (letters.slice(0, 2) || "TK").toUpperCase();
}

function isUniqueConstraintCollision(err: unknown, columns: string[]) {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError &&
    err.code === "P2002" &&
    columns.some((c) => (err.meta?.target as string[] | undefined)?.includes(c))
  );
}

/**
 * Runs `create` with a freshly generated ticketNumber, retrying on a unique
 * constraint collision (Prisma P2002). ticketNumber is globally unique
 * (not per-tenant) — the inbound email webhook needs to resolve "which
 * ticket does this reply belong to" before it knows the tenant, so a plain
 * 8-digit space with a few retries is simpler than coordinating a
 * cross-tenant sequence.
 */
export async function createWithTicketNumber<T>(create: (ticketNumber: string) => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return await create(randomTicketNumber());
    } catch (err) {
      if (!isUniqueConstraintCollision(err, ["ticketNumber"]) || attempt === 4) throw err;
    }
  }
  throw new Error("UNREACHABLE");
}

/**
 * Runs `create` with a freshly generated `{ reference, ticketNumber }` pair,
 * retrying on a unique constraint collision on either field. `reference` is
 * `{tenantInitials}-{5 random digits}` (e.g. "AC-48213") — random rather than
 * a `COUNT(*) + 1` sequence so concurrent ticket creation can't race into a
 * duplicate reference for the same tenant.
 */
export async function createWithReference<T>(
  tenantName: string,
  create: (fields: { reference: string; ticketNumber: string }) => Promise<T>
): Promise<T> {
  const prefix = initialsOf(tenantName);
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return await create({ reference: `${prefix}-${randomReferenceDigits()}`, ticketNumber: randomTicketNumber() });
    } catch (err) {
      if (!isUniqueConstraintCollision(err, ["reference", "ticketNumber"]) || attempt === 4) throw err;
    }
  }
  throw new Error("UNREACHABLE");
}
