// M20.6 — PII/PHI redaction for logs, transcripts, and error traces.
//
// Spec §3 pin: "Do NOT log PHI to Sentry or any third-party
// observability tool for HIPAA tenants. Errors log opaque IDs only."
//
// Two entry points:
//   - redactForLog(value, opts): scrub strings before shipping to any
//     external observability sink. Idempotent, best-effort — patterns
//     cover email, phone, SSN, credit-card-ish, IPv4, common date-of-
//     birth shapes, and generic 10+-digit runs.
//   - redactValueForShare(value, def): strip a CustomFieldValue's
//     typed value if its definition is PHI. Used by CSV export /
//     public share paths.

/** Compile-once patterns — order matters (more specific first). */
const PATTERNS: Array<{ name: string; re: RegExp; replacement: string }> = [
  { name: "email", re: /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, replacement: "[email]" },
  { name: "ssn", re: /\b\d{3}-?\d{2}-?\d{4}\b/g, replacement: "[ssn]" },
  { name: "cc", re: /\b(?:\d[ -]?){13,19}\b/g, replacement: "[cc]" },
  { name: "phone", re: /(?:\+?\d{1,3}[ .-]?)?(?:\(?\d{2,4}\)?[ .-]?)?\d{3}[ .-]?\d{4}/g, replacement: "[phone]" },
  { name: "ipv4", re: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g, replacement: "[ip]" },
  { name: "dob", re: /\b\d{4}-\d{2}-\d{2}\b/g, replacement: "[date]" },
];

export type RedactOptions = {
  /** If true, run redaction unconditionally (HIPAA tenants). Default true — logs should always be scrubbed at the boundary. */
  hipaa?: boolean;
};

export function redactForLog(value: unknown, _opts: RedactOptions = {}): string {
  const s = typeof value === "string" ? value : safeStringify(value);
  let out = s;
  for (const p of PATTERNS) out = out.replace(p.re, p.replacement);
  return out;
}

function safeStringify(v: unknown): string {
  try {
    return JSON.stringify(v, (_k, val) => (typeof val === "bigint" ? val.toString() : val));
  } catch {
    return String(v);
  }
}

/**
 * If the definition is PHI, return a "•••" placeholder for share/export
 * paths. Callers pass the raw value + the definition so this stays
 * side-effect-free.
 */
export function redactValueForShare<T>(value: T, definition: { isPhi?: boolean } | null): T | "•••" {
  if (definition?.isPhi) return "•••";
  return value;
}

/**
 * Sentinel used for opaque error ids on HIPAA tenants — see
 * loggableError() below. Callers should log the id and put the full
 * error somewhere private (or drop it entirely).
 */
export function loggableError(err: unknown, opts: { hipaa: boolean }): { id: string; message: string } {
  const id = "err_" + Math.random().toString(36).slice(2, 10);
  if (opts.hipaa) {
    // For HIPAA tenants, never expose the raw message externally.
    return { id, message: "internal error (redacted)" };
  }
  const message = err instanceof Error ? err.message : String(err);
  return { id, message: redactForLog(message) };
}
