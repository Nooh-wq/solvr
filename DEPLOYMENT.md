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
| `AWS_SES_REGION` / `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | Amazon SES (§6) | Outbound email. Omit the key pair if the host has an IAM task role with `ses:SendEmail` instead |
| `RESEND_API_KEY` / `RESEND_WEBHOOK_SECRET` | Resend (§6) | Inbound email-to-ticket only |
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

## 6. Email

Outbound (ticket notifications, invites, OTP codes, password resets) goes
through **Amazon SES**. Inbound (email-to-ticket) is unrelated infra and
still goes through **Resend** (§6b) — SES inbound needs its own MX/S3/SNS
setup, out of scope here. Setting up SES does **not** touch your domain's MX
record, so it has no effect on Microsoft 365 or any other mailbox you already
have on the same domain — SES only needs DNS records for sending
verification (DKIM/SPF), not mail routing.

### 6a. Amazon SES (outbound) — from scratch

1. **Pick a region.** SES is regional — open the
   [SES console](https://console.aws.amazon.com/ses/) in the region you'll
   use (e.g. `us-east-1`), and set `AWS_SES_REGION` to match.
2. **Verify a sending identity.** SES console → *Identities* → *Create
   identity* → *Domain* → enter the domain (or dedicated subdomain, e.g.
   `mail.<yourdomain>`) you'll send `from`. Enable **Easy DKIM** (2048-bit).
3. **Add the DNS records SES shows you** (3 DKIM `CNAME` records) at your DNS
   provider. This is additive — it doesn't replace or touch your existing
   MX/SPF records for M365 or any other mailbox on the domain.
4. **Wait for verification** — the identity flips to "Verified" once DNS
   propagates (usually minutes, occasionally longer).
5. **Request production access** — SES console → *Account dashboard* →
   *Request production access*. New accounts start in the **SES sandbox**,
   which only sends to individually-verified addresses; you must exit it
   before real users can receive email. The form asks for a use case
   (describe: transactional ticket/notification emails) and expected volume —
   approval is often near-instant, sometimes up to 24h.
6. **Create credentials:**
   - *Local dev:* IAM → *Users* → *Create user* → attach a policy scoped to
     `ses:SendEmail` + `ses:SendRawEmail` (the AWS-managed `AmazonSESFullAccess`
     works too, just broader) → *Security credentials* → *Create access key*.
     Set `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` in `.env`.
   - *Production (App Runner/ECS):* prefer an **IAM task role** with the same
     `ses:SendEmail` permission attached to the service/task definition
     instead of static keys — leave `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`
     unset and only set `AWS_SES_REGION`; the SDK's default credential
     provider chain picks up the task role automatically (see
     `src/lib/email/ses.ts`). No long-lived secret to rotate.
7. Set `DEFAULT_EMAIL_DOMAIN` to the verified domain from step 2.
8. **Test:** create a ticket or invite a user and confirm the email arrives;
   SES console → *Reputation & sending health* shows delivery stats.

Minimal IAM policy for the send-only credentials:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    { "Effect": "Allow", "Action": ["ses:SendEmail", "ses:SendRawEmail"], "Resource": "*" }
  ]
}
```

### 6b. Inbound email-to-ticket (Resend)

1. **Verify your sending domain** in Resend (DNS records) — used only for
   receiving here, not sending. Set an admin/tenant's support address
   (`/admin/branding`'s "Support email" field) to an address on that domain.
2. Add a Resend inbound route/webhook subscribed to `email.received`,
   pointing at `https://<your-domain>/api/webhooks/email-inbound`. Copy its
   signing secret into `RESEND_WEBHOOK_SECRET`, and set `RESEND_API_KEY`
   (needed to fetch a received email's body). The endpoint rejects unsigned
   requests.

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
3. Create a portal ticket → confirmation email arrives (SES live).
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
