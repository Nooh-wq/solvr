import * as Sentry from "@sentry/nextjs";
import { scrubSentryEvent } from "@/lib/sentry-scrub";

// Covers middleware.ts (edge runtime) — a separate init from
// sentry.server.config.ts because the edge runtime can't use all of the
// Node SDK's transports.
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  enabled: Boolean(process.env.SENTRY_DSN),
  tracesSampleRate: 0.1,
  sendDefaultPii: false,
  beforeSend: scrubSentryEvent,
});
