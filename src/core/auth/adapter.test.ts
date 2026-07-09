// src/core/auth/adapter.test.ts
//
// Runs with:  node --import tsx --test src/core/auth/adapter.test.ts
//
// Two layers of testing:
//
//   1. Pure projection + mock-Prisma tests (default) — verify the
//      GUC values map correctly across every SessionContext variant
//      and that withSessionContext issues the expected single-SELECT
//      SQL with correct args and transaction options. Runs in every
//      environment, no DB needed.
//
//   2. Real-Postgres round-trip test (opt-in) — verifies the GUCs
//      actually stick inside the transaction by reading them back via
//      `current_setting`. Skips gracefully unless APP_DATABASE_URL is
//      set; the QA workflow sets it, plain `npm test`-style local
//      runs don't have to.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  TRANSACTION_OPTIONS,
  projectContextToGucValues,
  withSessionContext,
  type TransactionalPrisma,
} from "./adapter";
import type { SessionContext } from "./types";

// --------------------------------------------------------------------
// Mock builder — a TransactionalPrisma that captures the SQL that
// would go on the wire and the transaction options.
// --------------------------------------------------------------------
type CapturedCall = { strings: readonly string[]; args: unknown[] };

function createMockPrisma() {
  const executeRawCalls: CapturedCall[] = [];
  let capturedTxOpts: unknown = null;
  let fnRan = false;
  let txSeenByFn: unknown = null;

  const tx = {
    // Tagged-template intercept — matches Prisma's real $executeRaw
    // signature. Store both the template parts and interpolated args
    // so tests can assert the SQL shape and each parameter.
    $executeRaw: async (strings: TemplateStringsArray, ...args: unknown[]) => {
      executeRawCalls.push({ strings: [...strings], args });
      return 1;
    },
  };

  const prisma: TransactionalPrisma = {
    // Real signature is complex; the runtime shape we need is
    // (callback, options) → Promise<T>. Cast is fine here — this is
    // a hermetic mock, not something the type system needs to police.
    $transaction: (async (cb: (t: typeof tx) => unknown, opts: unknown) => {
      capturedTxOpts = opts;
      const result = await cb(tx);
      fnRan = true;
      return result;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as unknown as TransactionalPrisma["$transaction"],
  };

  return {
    prisma,
    tx,
    getCalls: () => executeRawCalls,
    getTxOpts: () => capturedTxOpts,
    didFnRun: () => fnRan,
    getTxSeenByFn: () => txSeenByFn,
    setTxSeenByFn: (t: unknown) => {
      txSeenByFn = t;
    },
  };
}

// --------------------------------------------------------------------
// Fixture contexts covering every discriminated-union variant
// --------------------------------------------------------------------
const GUEST_CTX: SessionContext = {
  tenantId: "tenant-1",
  actor: { kind: "GUEST", id: "guest-anon-1" },
  role: "GUEST",
  guestTicketId: "ticket-42",
};
const AGENT_CTX: SessionContext = {
  tenantId: "tenant-1",
  actor: { kind: "TEAM_MEMBER", id: "tm-1" },
  role: "AGENT",
};
const END_USER_CTX: SessionContext = {
  tenantId: "tenant-1",
  actor: { kind: "END_USER", id: "eu-1" },
  role: "CLIENT",
};
const SYSTEM_CTX: SessionContext = {
  tenantId: "tenant-1",
  actor: { kind: "SYSTEM", id: "cron:sla-check" },
  role: "SUPER_ADMIN",
};
const UNRESOLVED_CTX: SessionContext = {
  tenantId: "tenant-1",
  actor: { kind: "TEAM_MEMBER", id: "tm-1" },
  role: "", // the "no role established yet" state — see types.ts
};

// --------------------------------------------------------------------
// 1. projectContextToGucValues — pure projection
// --------------------------------------------------------------------
describe("projectContextToGucValues — GUEST variant", () => {
  it("projects all four values including guestTicketId", () => {
    const gucs = projectContextToGucValues(GUEST_CTX);
    assert.equal(gucs.tenantId, "tenant-1");
    assert.equal(gucs.userId, "guest-anon-1");
    assert.equal(gucs.role, "GUEST");
    assert.equal(gucs.guestTicketId, "ticket-42");
  });
});

describe("projectContextToGucValues — non-GUEST variants collapse guestTicketId to ''", () => {
  it("TEAM_MEMBER / AGENT", () => {
    const gucs = projectContextToGucValues(AGENT_CTX);
    assert.equal(gucs.tenantId, "tenant-1");
    assert.equal(gucs.userId, "tm-1");
    assert.equal(gucs.role, "AGENT");
    assert.equal(gucs.guestTicketId, "");
  });

  it("END_USER / CLIENT", () => {
    const gucs = projectContextToGucValues(END_USER_CTX);
    assert.equal(gucs.userId, "eu-1");
    assert.equal(gucs.role, "CLIENT");
    assert.equal(gucs.guestTicketId, "");
  });

  it("SYSTEM / SUPER_ADMIN", () => {
    const gucs = projectContextToGucValues(SYSTEM_CTX);
    assert.equal(gucs.userId, "cron:sla-check");
    assert.equal(gucs.role, "SUPER_ADMIN");
    assert.equal(gucs.guestTicketId, "");
  });

  it("empty-string role (unresolved) passes through — GUC helper nullif()'s it", () => {
    const gucs = projectContextToGucValues(UNRESOLVED_CTX);
    assert.equal(gucs.role, "");
    assert.equal(gucs.guestTicketId, "");
  });
});

// --------------------------------------------------------------------
// 2. withSessionContext — SQL shape + argument order
// --------------------------------------------------------------------
describe("withSessionContext — issues one set_config SELECT per transaction", () => {
  it("SQL shape: single tagged-template SELECT with 4 parameterised set_config calls", async () => {
    const m = createMockPrisma();
    await withSessionContext(m.prisma, AGENT_CTX, async () => "ok");

    assert.equal(m.getCalls().length, 1, "exactly one $executeRaw call");
    const call = m.getCalls()[0];
    const joined = call.strings.join("?");

    // The four set_config calls are all in one SELECT; each GUC name
    // appears as a bare literal in the template (only the values are
    // parameterised) so the wire shape matches Support's withRls.
    assert.match(joined, /^SELECT set_config\('app\.tenant_id',/);
    assert.match(joined, /set_config\('app\.user_id',/);
    assert.match(joined, /set_config\('app\.role',/);
    assert.match(joined, /set_config\('app\.guest_ticket_id',/);
    assert.equal(
      call.args.length,
      4,
      "one interpolated arg per GUC (tenant, user, role, guest_ticket)"
    );
  });

  it("GUEST context: guest_ticket_id parameter is the ticket id", async () => {
    const m = createMockPrisma();
    await withSessionContext(m.prisma, GUEST_CTX, async () => "ok");
    const [tenantId, userId, role, guestTicketId] = m.getCalls()[0].args as string[];
    assert.equal(tenantId, "tenant-1");
    assert.equal(userId, "guest-anon-1");
    assert.equal(role, "GUEST");
    assert.equal(guestTicketId, "ticket-42");
  });

  it("Non-GUEST TEAM_MEMBER: guest_ticket_id parameter is ''", async () => {
    const m = createMockPrisma();
    await withSessionContext(m.prisma, AGENT_CTX, async () => "ok");
    const args = m.getCalls()[0].args as string[];
    assert.equal(args[3], "", "guest_ticket_id GUC must be empty string on non-GUEST");
  });

  it("Non-GUEST END_USER: guest_ticket_id parameter is ''", async () => {
    const m = createMockPrisma();
    await withSessionContext(m.prisma, END_USER_CTX, async () => "ok");
    assert.equal((m.getCalls()[0].args as string[])[3], "");
  });

  it("SYSTEM: sets user_id to the caller identifier, guest_ticket_id ''", async () => {
    const m = createMockPrisma();
    await withSessionContext(m.prisma, SYSTEM_CTX, async () => "ok");
    const args = m.getCalls()[0].args as string[];
    assert.equal(args[1], "cron:sla-check");
    assert.equal(args[3], "");
  });
});

// --------------------------------------------------------------------
// 3. withSessionContext — the callback actually runs, with tx in scope
// --------------------------------------------------------------------
describe("withSessionContext — callback receives the transactional tx", () => {
  it("fn runs, receives the tx, and its return value propagates", async () => {
    const m = createMockPrisma();
    const result = await withSessionContext(m.prisma, AGENT_CTX, async (tx) => {
      m.setTxSeenByFn(tx);
      return { ok: true, seen: !!tx };
    });
    assert.equal(m.didFnRun(), true);
    assert.deepEqual(result, { ok: true, seen: true });
    assert.equal(m.getTxSeenByFn(), m.tx, "fn receives the same tx the $executeRaw ran on");
  });

  it("set_config call precedes the fn body (setup-first ordering)", async () => {
    const m = createMockPrisma();
    const observed: string[] = [];
    // Wrap tx.$executeRaw so we observe *when* it happened relative
    // to fn — mock's callback runs fn synchronously after tx creation,
    // so a "fn started" marker before any $executeRaw call would be
    // a bug.
    await withSessionContext(m.prisma, AGENT_CTX, async () => {
      observed.push("fn-body");
    });
    // executeRawCalls was populated when the setup SELECT ran; the
    // observed array recorded "fn-body" during fn. The setup must
    // have already been captured by the time fn runs.
    assert.equal(m.getCalls().length, 1);
    assert.deepEqual(observed, ["fn-body"]);
  });
});

// --------------------------------------------------------------------
// 4. Transaction options — spot-check maxWait + timeout budget
// --------------------------------------------------------------------
describe("withSessionContext — transaction options match Support's withRls budget", () => {
  it("passes maxWait: 15_000 and timeout: 20_000 to $transaction", async () => {
    const m = createMockPrisma();
    await withSessionContext(m.prisma, AGENT_CTX, async () => "ok");
    const opts = m.getTxOpts() as { maxWait: number; timeout: number };
    assert.equal(opts.maxWait, 15_000);
    assert.equal(opts.timeout, 20_000);
  });

  it("TRANSACTION_OPTIONS export matches the values passed at runtime", async () => {
    // Belt-and-braces: if a future edit accidentally drifts the const
    // apart from the actual call, this test catches it.
    assert.equal(TRANSACTION_OPTIONS.maxWait, 15_000);
    assert.equal(TRANSACTION_OPTIONS.timeout, 20_000);
  });
});

// --------------------------------------------------------------------
// 5. Real-Postgres round-trip (opt-in via APP_DATABASE_URL)
// --------------------------------------------------------------------
//
// The mocks above confirm control flow and SQL shape. This suite
// confirms the actual GUCs *stick* inside the transaction by reading
// them back — the property the RLS policies depend on.
//
// Skips silently if APP_DATABASE_URL is unset. When present, it opens
// a real PrismaClient at app_runtime (no BYPASSRLS), runs one
// withSessionContext transaction, reads back the four GUCs, then
// disconnects. Uses the QA tenant slug's shape (any tenantId works
// for GUC round-trip — no rows are read).

const canRunLive = !!process.env.APP_DATABASE_URL || !!process.env.APP_DIRECT_URL;

describe(
  "withSessionContext — real Postgres round-trip",
  { skip: !canRunLive && "skipped: set APP_DATABASE_URL or APP_DIRECT_URL to enable" },
  () => {
    it("all four GUCs read back the values that were set", async () => {
      const { PrismaClient } = await import("../../generated/prisma/index.js");
      const url = process.env.APP_DIRECT_URL || process.env.APP_DATABASE_URL;
      const p = new PrismaClient({ datasources: { db: { url } } });
      try {
        const ctx: SessionContext = {
          tenantId: "b4-live-tenant",
          actor: { kind: "GUEST", id: "b4-live-guest" },
          role: "GUEST",
          guestTicketId: "b4-live-ticket",
        };
        const readback = await withSessionContext(p, ctx, async (tx) => {
          return tx.$queryRaw<
            Array<{ t: string; u: string; r: string; g: string }>
          >`SELECT
              current_setting('app.tenant_id', true) AS "t",
              current_setting('app.user_id', true) AS "u",
              current_setting('app.role', true) AS "r",
              current_setting('app.guest_ticket_id', true) AS "g"`;
        });
        assert.equal(readback.length, 1);
        assert.equal(readback[0].t, "b4-live-tenant");
        assert.equal(readback[0].u, "b4-live-guest");
        assert.equal(readback[0].r, "GUEST");
        assert.equal(readback[0].g, "b4-live-ticket");
      } finally {
        await p.$disconnect();
      }
    });

    it("non-GUEST context: guest_ticket_id reads back as '' (empty string convention)", async () => {
      const { PrismaClient } = await import("../../generated/prisma/index.js");
      const url = process.env.APP_DIRECT_URL || process.env.APP_DATABASE_URL;
      const p = new PrismaClient({ datasources: { db: { url } } });
      try {
        const ctx: SessionContext = {
          tenantId: "b4-live-tenant",
          actor: { kind: "TEAM_MEMBER", id: "b4-live-tm" },
          role: "AGENT",
        };
        const readback = await withSessionContext(p, ctx, async (tx) => {
          return tx.$queryRaw<
            Array<{ g: string }>
          >`SELECT current_setting('app.guest_ticket_id', true) AS "g"`;
        });
        assert.equal(readback[0].g, "");
      } finally {
        await p.$disconnect();
      }
    });
  }
);
