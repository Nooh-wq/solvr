<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# src/core/* is an extraction candidate — hard import rule

Everything under `src/core/*` (currently `src/core/auth/*` and `src/core/rbac/*`) is scoped for extraction to Shared Platform when HRMS or CRM starts consuming it (see [boundary doc §7.19 M-core-extraction](docs/shared-platform-boundary.md)). The invariant that keeps that extraction cheap:

**`src/core/*` MUST NOT import from `src/lib/*` or `src/app/*`.**

Anything core needs must live inside `src/core/*` itself (adjacent modules) or come from allowlisted third-party packages (`jose`, `next/server` types, generated Prisma client types, etc.). The dependency arrow always points inward: `app` → `lib` → `core`, never back.

Enforced two ways:
- **Hard rule** — ESLint's `no-restricted-imports` blocks the pattern under `src/core/**` (see `eslint.config.mjs`). CI fails on violation.
- **Cultural rule** — this section. Reviewers reject any PR that tries to satisfy a core need by reaching into `lib/` or `app/`. If a shared piece is required, move it into `src/core/` first.

Same discipline as ADR-004's "reference models are read-only": when a rule exists to keep a future extraction sound, the tests aren't the last word — reviewers are.
