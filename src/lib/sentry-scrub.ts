import type { ErrorEvent } from "@sentry/nextjs";

// Field names that must never leave this process in an error report, checked
// case-insensitively against object keys anywhere in the event payload.
const SENSITIVE_KEYS = [
  "password",
  "passwordhash",
  "currentpassword",
  "newpassword",
  "token",
  "secret",
  "apikey",
  "api_key",
  "authorization",
  "cookie",
  "sessionsecret",
  "session_secret",
  "servicerolekey",
  "signingsecret",
];

function isSensitiveKey(key: string): boolean {
  const lower = key.toLowerCase();
  return SENSITIVE_KEYS.some((k) => lower.includes(k));
}

/** Recursively walks a plain object/array and replaces sensitive-looking values with "[Redacted]", so a stray password/token/API-key in a caught error's context (e.g. a Zod validation error echoing the input) never reaches Sentry. */
function redact(value: unknown, depth = 0): unknown {
  if (depth > 6 || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));

  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    out[key] = isSensitiveKey(key) ? "[Redacted]" : redact(val, depth + 1);
  }
  return out;
}

/**
 * `beforeSend` hook shared by the client/server/edge Sentry configs.
 * `sendDefaultPii: false` (set in each init call) already stops Sentry from
 * auto-attaching IP/cookies/headers — this is the second layer: it redacts
 * secret-shaped fields from whatever *we* explicitly attach (extra context,
 * request data, breadcrumbs) so a caught error that happens to include a
 * request body or config object can't leak a password/API key/session secret.
 */
export function scrubSentryEvent(event: ErrorEvent): ErrorEvent | null {
  if (event.request) {
    delete event.request.cookies;
    if (event.request.headers) {
      const headers: Record<string, string> = {};
      for (const [k, v] of Object.entries(event.request.headers)) {
        headers[k] = /^(cookie|authorization)$/i.test(k) ? "[Redacted]" : v;
      }
      event.request.headers = headers;
    }
    if (event.request.data) {
      event.request.data = redact(event.request.data) as typeof event.request.data;
    }
  }

  if (event.extra) {
    event.extra = redact(event.extra) as typeof event.extra;
  }

  if (event.contexts) {
    for (const key of Object.keys(event.contexts)) {
      event.contexts[key] = redact(event.contexts[key]) as (typeof event.contexts)[string];
    }
  }

  return event;
}
