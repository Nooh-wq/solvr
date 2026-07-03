import * as Sentry from "@sentry/nextjs";
import { scrubSentryEvent } from "@/lib/sentry-scrub";

// Browser-side init. Uses NEXT_PUBLIC_SENTRY_DSN (not SENTRY_DSN) since this
// file ships in the client bundle — anything without the NEXT_PUBLIC_ prefix
// wouldn't be available here anyway, and a DSN is meant to be public (it can
// only submit events, not read anything back).
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  enabled: Boolean(process.env.NEXT_PUBLIC_SENTRY_DSN),
  tracesSampleRate: 0.1,
  sendDefaultPii: false,
  beforeSend: scrubSentryEvent,
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
