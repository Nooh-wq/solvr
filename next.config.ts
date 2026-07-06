import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

// Supabase Storage origin (public bucket for logos/avatars) needs to be an
// allowed image source under the CSP below. Derived from the same env var the
// storage client uses so custom-domain Supabase projects work without edits.
const supabaseOrigin = (() => {
  try {
    return process.env.NEXT_PUBLIC_SUPABASE_URL ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).origin : "";
  } catch {
    return "";
  }
})();

// Content-Security-Policy. Deliberately conservative rather than nonce-based:
// Next.js injects inline bootstrap styles/scripts, so 'unsafe-inline' is
// required until a nonce pipeline is wired up (SECURITY-DECISION below).
// frame-ancestors 'none' is the real anti-clickjacking control here (a
// superset of X-Frame-Options, which is kept too for older browsers).
const csp = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  // SECURITY-DECISION: 'unsafe-inline'/'unsafe-eval' on script-src is needed
  // for Next.js dev + its inline runtime. Tighten to a nonce-based policy
  // before production if you can budget the Next middleware work for it.
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "worker-src 'self' blob:",
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob:${supabaseOrigin ? ` ${supabaseOrigin}` : ""}`,
  "font-src 'self' data:",
  `connect-src 'self' https://cdn.jsdelivr.net${supabaseOrigin ? ` ${supabaseOrigin}` : ""}`,
  "frame-src 'none'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  // Force HTTPS for 2 years incl. subdomains (tenant custom domains). Only
  // sent in prod — sending HSTS from http://localhost would wedge local dev.
  ...(process.env.NODE_ENV === "production"
    ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" }]
    : []),
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), browsing-topics=()" },
  { key: "X-DNS-Prefetch-Control", value: "off" },
];

const nextConfig: NextConfig = {
  // geoip-lite loads its .dat files via a `__dirname`-relative fs.readFileSync
  // at require time — Turbopack/webpack bundling for server components
  // rewrites/sandboxes that path (surfaces as "ENOENT ...C:\ROOT\node_modules
  // \geoip-lite\data\..." in dev), so it needs to stay a real, unbundled
  // `require()` at runtime instead of being processed through the bundler.
  serverExternalPackages: ["geoip-lite"],
  // Emit a self-contained server bundle (.next/standalone) so the Docker image
  // can run `node server.js` without dev dependencies — used by the Dockerfile
  // for AWS App Runner / ECS Fargate and Azure Container Apps / App Service.
  // Skipped on Vercel (process.env.VERCEL is set there): Vercel packages each
  // route as its own serverless function using this same file-tracing info
  // directly and doesn't need (or want) the standalone server.js output.
  output: process.env.VERCEL ? undefined : "standalone",
  // Force the generated Prisma client + its native query-engine binary into
  // the standalone trace. Next's file tracing sometimes misses the engine
  // `.node` (it's loaded via a runtime path, not a static import), which
  // surfaces in the container as "Query engine library not found".
  outputFileTracingIncludes: {
    "/**": ["./src/generated/prisma/**"],
  },
  // Don't advertise the framework/version to attackers.
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

// Wraps the config to auto-instrument routes and (in CI, when
// SENTRY_ORG/PROJECT/AUTH_TOKEN are set) upload source maps for readable
// stack traces. Silently skips the upload step if those aren't set — this
// stays a no-op-safe wrapper for local dev / any env without Sentry configured.
export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: true,
  widenClientFileUpload: true,
  disableLogger: true,
  // Proxies client-side Sentry traffic through our own /monitoring route
  // (same-origin) instead of directly to ingest.sentry.io — keeps the CSP's
  // connect-src scoped to 'self' and avoids ad-blockers dropping the request.
  tunnelRoute: "/monitoring",
});
