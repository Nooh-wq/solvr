# `src/lib/shared-platform/` — the wrapper

Typed data-access layer for the Stralis Shared Platform's six-object identity model (Organizations, EndUsers, TeamMembers, Groups, Roles, Tags), plus its polymorphic TagAssignment join and its generic CoreAuditLog.

Every Support-app consumer that needs to read or write one of the shared-platform tables goes through this wrapper. Never through `prisma.organization.*` or `prisma.teamMember.*` directly — that's rule 4 in [`docs/shared-platform-boundary.md`](../../../docs/shared-platform-boundary.md).

## Why the wrapper exists

The shared-platform tables are owned by a separate repo (`../Stralis Shared Platform`). Both repos connect to the same physical Supabase database today. That's the pre-M7 arrangement.

Once the Shared Platform ships its Public API (milestone M7), each function in this wrapper flips its internals from a `withRls(...) prisma.*` call to a `fetch("https://shared-platform.stralis.app/api/v1/...")` call. Consumer code never changes — the wrapper is the single point where the swap happens.

To keep that swap surgical, every design choice in the wrapper mirrors what an HTTP API would look like:

- Every function takes a `WrapperContext` as its first argument, mirroring how an API caller sends credentials / tenant scope on every request.
- Every function returns clean DTOs (`Organization`, `EndUser`, ...) rather than raw Prisma row types — the M7 API will serialize JSON, not Prisma objects.
- Errors are thrown as one of three `Wrapper*Error` classes that map cleanly to HTTP status codes.
- Pagination is cursor-based (opaque `nextCursor` handed back to callers), not offset.

## How to import

```ts
import {
  systemContext,
  contextFromSession,
  getOrganization,
  createTeamMember,
  seedStandardRoles,
  WrapperValidationError,
  type WrapperContext,
  type Organization,
} from "@/lib/shared-platform";
```

Never import from a specific sibling file (`.../organizations`) — always the barrel.
Never import from `@/generated/prisma` in consumer code — that would couple you to the Shared Platform's internal schema and break the M7 swap.

## The context primitive

Every function takes a `WrapperContext` as first argument:

```ts
type WrapperContext = {
  tenantId: string;
  actor: { teamMemberId: string } | null; // null = system actor
};
```

Two helpers build one:

- `systemContext(tenantId)` — for backfills, cron jobs, unauthenticated verification flows. Every mutation attributes as SYSTEM in `core_audit_logs`.
- `contextFromSession(session)` — for authenticated Support-app server actions. Looks up the TeamMember row by `session.email`. Between now and Z1.3 backfill (no `team_members` rows exist yet for anyone), this returns `actor: null` and audit entries attribute as SYSTEM — expected transition behavior.

`role` is deliberately NOT exposed on `WrapperContext`. The shared-platform tables' RLS policies only check `tenantId`, so a role field would be dead weight on the surface — and would need to be removed for the M7 swap anyway.

## Error taxonomy

Three specific classes, catch them narrowly (never `Error` broadly):

| Class | When | HTTP equivalent (post-M7) |
|---|---|---|
| `WrapperNotFoundError` | Mutation targets a row that doesn't exist (or is in another tenant — RLS makes it invisible). Reads return `null` instead. | 404 |
| `WrapperConflictError` | Mutation would violate a unique constraint (`(tenantId, name)`, email, ...). Carries `field` + `value`. | 409 |
| `WrapperValidationError` | A business-rule guard rejected the mutation. Carries a stable `reason` code (`LAST_SUPER_ADMIN`, `DUPLICATE_DEFAULT_GROUP`, `STANDARD_ROLE_MODIFY`, ...). | 422 |

See `errors.ts` for the full list of `reason` codes with the guard each one belongs to.

## Guards enforced inside the wrapper

The wrapper enforces every invariant that would otherwise be a repeated concern for every caller. Each guard's code carries a comment linking to the milestone or ADR that established it, so the traceability isn't lost.

| Guard | Where | Reason code |
|---|---|---|
| Last Super Admin cannot be demoted or deleted | `updateTeamMember`, `deleteTeamMember`, `upsertTeamMemberByEmail` (on role change path) | `LAST_SUPER_ADMIN` |
| Cannot create a second default group | `createGroup` (isDefault:true path) | `DUPLICATE_DEFAULT_GROUP` |
| Cannot unset the last default group | `updateGroup` (isDefault:false path) | `CANNOT_UNSET_LAST_DEFAULT_GROUP` |
| Cannot delete the default group | `deleteGroup` | `DEFAULT_GROUP_DELETE` |
| Standard roles are immutable | `updateRole`, `deleteRole` | `STANDARD_ROLE_MODIFY` |
| Cannot delete a role still assigned to any TeamMember | `deleteRole` | `ROLE_IN_USE` |
| roleId must exist in tenant | `createTeamMember`, `updateTeamMember`, `upsertTeamMemberByEmail` | `INVALID_ROLE` |

The default-group guards close 99% of the door but leave a small race window for two simultaneous `createGroup({ isDefault: true })` calls — a matching DB-level partial unique index on `groups(tenantId) WHERE isDefault = true` is filed as a required Shared Platform migration in [`docs/shared-platform-boundary.md`](../../../docs/shared-platform-boundary.md) §7.4.

## Conventions

- `getX(id)` returns `null` on miss. `updateX`/`deleteX` throw `WrapperNotFoundError`.
- `assign*` / `attach*` / `upsert*` are idempotent — re-running with the same args is a no-op (no audit row for the no-op).
- `upsert*ByEmail` and `upsertOrganizationByName` use **PATCH-style overwrite semantics** — every key present in `input` overwrites the existing row's column (including with explicit `null`); keys absent from `input` leave existing values untouched. Deterministic under re-run; safe for the Z1.3 backfill.
- `CreateOrganizationInput`, `CreateEndUserInput`, `CreateTeamMemberInput` accept an optional `id?: string`. **Online consumers should never pass `id`** — leave it undefined and Prisma allocates a fresh cuid. Passing `id` is a backfill-time concern only (Z1.3 needs it to preserve legacy `User.id` / `Company.id` across the boundary — see [`docs/shared-platform-boundary.md`](../../../docs/shared-platform-boundary.md) §7.6).
- Every mutation function opens a `withRls` transaction that includes both the mutation and its CoreAuditLog write. Atomic or roll back together.
- Dates are `Date` objects. When we swap to HTTP in M7, the wrapper parses ISO strings from the API response back into `Date` internally.

## How to add a new function

Checklist:

1. Add the DTO / input types to `types.ts` if they don't exist.
2. Implement the function in the appropriate resource file.
3. Open a `withRls` transaction with `role: "SUPER_ADMIN"` (shared-platform RLS only checks `tenantId`; this role choice is deliberate — see `context.ts` header comment).
4. For mutations, call `writeCoreAuditLogInTx(tx, ctx, entry)` at the end of the transaction — never a separate `writeCoreAuditLog` outside the tx, or mutation + audit can drift.
5. Translate Prisma's `P2002` unique-violation errors to `WrapperConflictError` via the local `translateUnique` helper (copy the pattern from an existing file).
6. Return a DTO shape, never a raw Prisma row — the M7 swap can't fake Prisma row types.
7. If the function enforces a business rule, add a comment linking to the milestone / ADR / PR that established the rule. Uncommented guards fail code review.
8. Re-export from `index.ts`? Automatic via `export *`.

## The M7 swap plan

Today, each function looks like:

```ts
export async function getOrganization(ctx: WrapperContext, id: string): Promise<Organization | null> {
  const row = await withRls({ ... }, (tx) =>
    tx.organization.findFirst({ where: { id, tenantId: ctx.tenantId } })
  );
  return row ? toDto(row) : null;
}
```

Post-M7:

```ts
export async function getOrganization(ctx: WrapperContext, id: string): Promise<Organization | null> {
  const res = await sharedFetch(ctx, `/api/v1/organizations/${id}`);
  if (res.status === 404) return null;
  return parseOrganizationJson(await res.json());
}
```

Consumers don't change. `types.ts` doesn't change. `errors.ts` doesn't change. When that day comes:

- The mirror block in `prisma/schema.prisma` can be removed.
- This repo's Prisma Client no longer knows about the shared models.
- Cross-DB coordination stops mattering — everything goes through HTTP.

See [`docs/shared-platform-boundary.md`](../../../docs/shared-platform-boundary.md) §2 for the full plan.
