import * as Sentry from "@sentry/nextjs";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("../sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("../sentry.edge.config");
  }
}

// Reports server component / server action / route handler errors that
// Next's own error boundary swallows before they'd otherwise reach Sentry.
export const onRequestError = Sentry.captureRequestError;
