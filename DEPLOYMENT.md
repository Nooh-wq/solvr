# Deployment Guide — solvr

Production deploy as a **Docker container** on **AWS** (App Runner or ECS
Fargate) or **Azure** (Container Apps or App Service for Containers), reusing
the existing Supabase Postgres project as the production database.

The app is a long-running Node server (not serverless), so a single container
image runs everything: the Next.js app, server actions, edge middleware, and
the inbound-email / Inngest webhook routes.

---

## 0. Pre-flight (already done in the codebase)

- ✅ `output: "standalone"` + `Dockerfile` + `.dockerignore` — container build ready.
- ✅ Prisma engine target `debian-openssl-3.0.x` for the container base image.
- ✅ Security headers (CSP, HSTS, X-Frame-Options, nosniff, Referrer/Permissions-Policy).
- ✅ RLS verified enabled + forced on all 14 tenant tables; `app_runtime` role is non-superuser / non-BYPASSRLS.
- ✅ `passwordChangedAt` column present (session-invalidation on password change).
- ✅ Rate limiter supports Upstash Redis (falls back to in-memory when unset).
- ✅ App refuses to boot in production with the dev `SESSION_SECRET`.
- ✅ Password reset: signed single-use link (30 min), email-enumeration safe, auto-login on success.
- ✅ Sentry wired for client/server/edge with PII scrubbing (`beforeSend`) — no-ops until a DSN is set.

---

## 1. Secrets & environment variables

Set these on the host (App Runner config / ECS task definition / Container Apps
secrets / App Service application settings). **Never** bake them into the image.

| Var | Value | Notes |
|-----|-------|-------|
| `NODE_ENV` | `production` | Enables HSTS + secret guard + secure cookies |
| `SESSION_SECRET` | `openssl rand -base64 48` | **New, unique.** Not the dev placeholder — the app will refuse to boot. |
| `APP_DATABASE_URL` / `APP_DIRECT_URL` | from `.env` | Least-privilege `app_runtime` role — the app connects with these |
| `DATABASE_URL` / `DIRECT_URL` | from `.env` | `postgres` role — used only if you run migrations from the container |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL | Also drives the CSP `img-src`/`connect-src` allowlist |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key | Public-safe |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service key | Server-only — image uploads |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | Upstash (§3) | Real rate limiting |
| `RESEND_API_KEY` / `RESEND_WEBHOOK_SECRET` | Resend (§5) | Outbound + inbound email |
| `ANTHROPIC_API_KEY` | **rotated** key | AI copilot + chatbot. Rotate the one pasted in chat. |
| `APP_BASE_DOMAIN` | e.g. `solvr.app` | For `<slug>.solvr.app` tenant routing |
| `NEXT_PUBLIC_SITE_URL` | e.g. `https://app.solvr.app` | Absolute URLs in emails |
| `INNGEST_EVENT_KEY` / `INNGEST_SIGNING_KEY` | Inngest Cloud (§6) | Background jobs |
| `SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN` | Sentry project DSN (§6b) | Same value in both — server and browser read different var names |
| `SENTRY_ORG` / `SENTRY_PROJECT` / `SENTRY_AUTH_TOKEN` | optional | Only for source-map upload during the image build (CI) |

> The database, RLS, `app_runtime` role, and `passwordChangedAt` column already
> exist on this Supabase project, so **no migration step is required** for the
> first deploy. If you later move to a fresh Supabase project, run
> `npm run db:push && npm run db:rls && node scripts/create-app-runtime-role.mjs`
> against it first.

---

## 2. Generate the session secret

```bash
openssl rand -base64 48
```
Paste the output as `SESSION_SECRET` in the host's secret store.

---

## 3. Upstash Redis (rate limiting)

1. Create a free database at **console.upstash.com** → Redis → Create (pick the
   region closest to your app region).
2. On the database page, copy **REST URL** and **REST Token**.
3. Set `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` on the host.

Leaving these unset falls back to the in-memory limiter, which only protects a
single instance — set them before scaling past one container.

---

## 4. Build & push the image

```bash
# Build locally to confirm it compiles (needs Docker Desktop):
docker build -t solvr .
docker run -p 3000:3000 --env-file .env.production solvr   # smoke test

# AWS (ECR):
aws ecr create-repository --repository-name solvr
docker tag solvr <acct>.dkr.ecr.<region>.amazonaws.com/solvr:latest
docker push <acct>.dkr.ecr.<region>.amazonaws.com/solvr:latest

# Azure (ACR):
az acr build --registry <registry> --image solvr:latest .
```

The container listens on **port 3000** (`PORT`/`HOSTNAME` are set in the image).

---

## 5. Deploy the container

### AWS App Runner (simplest)
- Source: the ECR image. Port: `3000`. Add all §1 env vars (mark secrets as secrets).
- Health check path: `/auth/login` (returns 200 unauthenticated).
- Auto-scaling: fine at 1–N instances now that rate limiting is Redis-backed.

### AWS ECS Fargate (more control)
- Task definition: the ECR image, container port `3000`, env/secrets from §1
  (use Secrets Manager / SSM for secret values). Put an ALB in front (HTTPS
  listener, ACM cert) targeting `3000`.

### Azure Container Apps (simplest on Azure)
- Create from the ACR image, target port `3000`, ingress external.
- Add §1 env vars; store secrets as Container App secrets and reference them.

### Azure App Service for Containers
- Web App for Containers from ACR, `WEBSITES_PORT=3000`, app settings from §1.

---

## 6. Email (Resend)

1. **Verify your sending domain** in Resend (DNS records) so outbound ticket
   emails don't land in spam. Set `DEFAULT_EMAIL_DOMAIN` accordingly.
2. **Inbound (email-to-ticket):** add a Resend inbound route/webhook subscribed
   to `email.received`, pointing at
   `https://<your-domain>/api/webhooks/email-inbound`. Copy its signing secret
   into `RESEND_WEBHOOK_SECRET`. The endpoint rejects unsigned requests.

## 6b. Error tracking (Sentry)

1. Create a project at **sentry.io** (platform: Next.js).
2. Copy its DSN into **both** `SENTRY_DSN` and `NEXT_PUBLIC_SENTRY_DSN` (server
   and browser read different env var names, same value).
3. Optional, for readable production stack traces: create an internal
   integration / auth token, set `SENTRY_ORG`, `SENTRY_PROJECT`,
   `SENTRY_AUTH_TOKEN` **as build-time** args/secrets (source maps upload
   during `docker build`, not at runtime).
4. Leaving all of these unset is fine — Sentry fully no-ops (no network calls).

## 7. Background jobs (Inngest)

- Create an app in **Inngest Cloud**, set `INNGEST_EVENT_KEY` + `INNGEST_SIGNING_KEY`.
- Register the sync URL `https://<your-domain>/api/inngest` in the Inngest dashboard.

## 8. DNS & TLS

- Point `app.<domain>` (host tenant) and a **wildcard** `*.<domain>` (per-tenant
  subdomains) at the app's public endpoint.
- Terminate TLS at the load balancer / platform ingress (ACM on AWS, managed
  cert on Azure). HSTS is emitted by the app in production.
- Tenant **custom domains**: add each as an additional hostname/cert on the
  ingress; the app already resolves them via `Tenant.customDomain`.

---

## 9. Post-deploy smoke test

1. Load `https://app.<domain>/auth/login` → renders, security headers present
   (`curl -I`).
2. Log in as an admin → dashboard loads.
3. Create a portal ticket → confirmation email arrives (Resend live).
4. Change your password → other sessions log out, current stays in.
5. Use "Forgot password" → email arrives, link sets a new password and logs
   you in, and re-using the same link is rejected as "already been used".
6. Open the AI chatbot → grounded answer (Anthropic live).
7. Trigger a deliberate error (e.g. hit a bad route) → appears in the Sentry
   dashboard within a minute, with no password/token/cookie fields visible in
   the event payload.

## 10. Housekeeping before go-live

- **Rotate** the Anthropic key that was shared in chat.
- **Remove demo/seed data** from the production tenant if you don't want it
  visible (the seeded `stralis`/solvr host tenant + demo tickets/users).
