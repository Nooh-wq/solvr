# Multi-stage build producing a small, self-contained Next.js standalone image.
# Runs on AWS App Runner / ECS Fargate and Azure Container Apps / App Service
# for Containers alike — anything that can run an OCI image listening on $PORT.
#
#   docker build -t solvr .
#   docker run -p 3000:3000 --env-file .env.production solvr
#
# NOTE: Prisma's engine binary target is set in prisma/schema.prisma
# (debian-openssl-3.0.x) to match this bookworm-slim base.

# ---- deps: install production + build deps against a cached layer -----------
FROM node:20-bookworm-slim AS deps
WORKDIR /app
# openssl is required by Prisma's query engine at runtime.
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
# Skip postinstall's `prisma generate` here (schema isn't copied yet); it runs
# in the build stage below once the schema is present.
RUN npm ci --ignore-scripts

# ---- build: compile the app + generate the Prisma client --------------------
FROM node:20-bookworm-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Generate the Prisma client (incl. the debian engine) then build Next.
RUN npx prisma generate
# A dummy DATABASE_URL lets `next build` run without a live DB connection
# (no queries run at build time — pages are all dynamic/server-rendered).
ENV DATABASE_URL="postgresql://user:pass@localhost:5432/db"
ENV DIRECT_URL="postgresql://user:pass@localhost:5432/db"
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ---- runner: minimal runtime image -----------------------------------------
FROM node:20-bookworm-slim AS runner
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Run as an unprivileged user.
RUN groupadd --system --gid 1001 nodejs && useradd --system --uid 1001 --gid nodejs nextjs

# Standalone output bundles a minimal node_modules + server.js.
COPY --from=build --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=build --chown=nextjs:nodejs /app/public ./public

USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
