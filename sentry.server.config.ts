import * as Sentry from "@sentry/nextjs";
import { scrubSentryEvent } from "@/lib/sentry-scrub";

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  // No-ops (doesn't even try to reach Sentry) when SENTRY_DSN isn't set, so
  // local dev / any environment without a DSN configured stays silent.
  enabled: Boolean(process.env.SENTRY_DSN),
  // Modest trace sampling — this is an error-tracking wire-up, not full APM.
  tracesSampleRate: 0.1,
  // Don't auto-attach IP/cookies/headers; see sentry-scrub.ts for the second
  // layer that redacts secret-shaped fields from whatever we DO attach.
  sendDefaultPii: false,
  beforeSend: scrubSentryEvent,
});
