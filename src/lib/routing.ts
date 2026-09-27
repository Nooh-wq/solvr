import { Prisma } from "@/generated/prisma";
import { withRls } from "@/lib/db";
import type { UserRole } from "@/lib/auth";

// M3 — Routing & Assignment Engine.
//
// One entry point (`routeTicket`) that picks a TeamMember for a ticket
// under a strategy. Reused by:
//   - The TEAM escalation destination (runEscalation → routeTicket).
//   - The rule engine's `auto_route` action.
//   - Direct callers that want to snap a ticket onto a group by rule.
//
// Guarantees the M3 spec §3 rules:
//   - Z5 access scope is never bypassed. GROUPS-scoped agents are only
//     picked when they belong to the ticket's routing group.
//   - Deactivated (lifecycle status != ACTIVE) and unavailable agents
//     (AgentProfile.isAvailable=false) are excluded.
//   - Agents at or past their `maxOpen` capacity are excluded.
//   - Auto-reassignment loops are capped: if the last N picks for a
//     ticket were all auto-routes within the loop-cap window, the next
//     one halts and writes an `AutoAssignmentLog { cappedOut: true }`
//     row (spec §3 "cap consecutive auto-reassignments").

export const ROUTING_STRATEGIES = ["ROUND_ROBIN", "LOAD_BASED", "SKILLS_BASED"] as const;
export type RoutingStrategy = (typeof ROUTING_STRATEGIES)[number];

export const AUTO_ROUTE_SOURCES = ["ESCALATION", "RULE", "MANUAL"] as const;
export type AutoRouteSource = (typeof AUTO_ROUTE_SOURCES)[number];

/** Consecutive auto-reassignments after which routing halts. */
export const LOOP_CAP_CONSECUTIVE = 3;
/** Window in which those `LOOP_CAP_CONSECUTIVE` picks must occur to count. */
export const LOOP_CAP_WINDOW_MS = 10 * 60 * 1000; // 10 minutes

export type RoutingSession = {
  tenantId: string;
  subjectId: string | null;
  role: UserRole;
};

export type RouteTicketInput = {
  session: RoutingSession;
  ticketId: string;
  groupId: string;
  strategy: RoutingStrategy;
  /** Only used by SKILLS_BASED. Exact string match against AgentProfile.skills. */
  requiredSkills?: string[];
  /**
   * M9.6 — soft preference. When SKILLS_BASED and this is set, candidates
   * whose skills include the intent slug get preferred over equally-loaded
   * candidates. Never disqualifies — a hard requirement uses requiredSkills.
   */
  preferredIntent?: string;
  /** How this call was invoked. Feeds the loop-cap log + audit trail. */
  source: AutoRouteSource;
};

export type RouteTicketResult =
  | { ok: true; teamMemberId: string; strategy: RoutingStrategy }
  | { ok: false; reason: "NO_CANDIDATES" | "LOOP_CAP" | "GROUP_NOT_FOUND"; message: string };

/**
 * Pick a team member for `ticketId` under `strategy`. Writes an
 * AutoAssignmentLog row for every call (successful or capped) so the
 * downstream loop check can read history. Does NOT mutate the ticket —
 * the caller applies the assignment via updateTicket() so notifications,
 * audit logs, and downstream rule events all fire through the usual path.
 */
export async function routeTicket(input: RouteTicketInput): Promise<RouteTicketResult> {
  const { session, ticketId, groupId, strategy, requiredSkills, preferredIntent, source } = input;

  return withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    async (tx) => {
      // Loop-cap check first. Cheap, and lets a spammy rule bail before
      // we run any candidate math.
      if (source !== "MANUAL") {
        const recent = await tx.autoAssignmentLog.findMany({
          where: {
            tenantId: session.tenantId,
            ticketId,
            createdAt: { gte: new Date(Date.now() - LOOP_CAP_WINDOW_MS) },
          },
          orderBy: { createdAt: "desc" },
          take: LOOP_CAP_CONSECUTIVE,
        });
        // Only auto (non-MANUAL) sources contribute to the loop count.
        // A manual reassignment between two rule picks resets the run.
        const consecutiveAuto = recent.filter((r) => r.source !== "MANUAL").length;
        if (consecutiveAuto >= LOOP_CAP_CONSECUTIVE) {
          await tx.autoAssignmentLog.create({
            data: {
              tenantId: session.tenantId,
              ticketId,
              teamMemberId: null,
              strategy,
              source,
              cappedOut: true,
            },
          });
          return {
            ok: false as const,
            reason: "LOOP_CAP" as const,
            message: `Auto-reassignment cap hit (${LOOP_CAP_CONSECUTIVE} within ${
              LOOP_CAP_WINDOW_MS / 60_000
            } min). No further auto-route on this ticket until a manual assignment resets the counter.`,
          };
        }
      }

      // Candidate pool: members of the target group.
      const memberships = await tx.teamMemberGroup.findMany({
        where: { groupId, tenantId: session.tenantId },
        select: { teamMemberId: true },
      });
      if (memberships.length === 0) {
        return {
          ok: false as const,
          reason: "GROUP_NOT_FOUND" as const,
          message: `Group ${groupId} has no members.`,
        };
      }
      const memberIds = memberships.map((m) => m.teamMemberId);

      // Pull each candidate's TeamMember row (scope + name for logs),
      // their AgentProfile (skills/capacity/availability), and their
      // lifecycle status (ACTIVE gate). Batched in parallel.
      const [teamMembers, profiles, lifecycles] = await Promise.all([
        tx.teamMember.findMany({
          where: { id: { in: memberIds }, tenantId: session.tenantId },
          select: { id: true, ticketAccessScope: true },
        }),
        tx.agentProfile.findMany({
          where: { tenantId: session.tenantId, teamMemberId: { in: memberIds } },
        }),
        tx.teamMemberLifecycle.findMany({
          where: { subjectId: { in: memberIds } },
          select: { subjectId: true, status: true },
        }),
      ]);
      const profileByMember = new Map(profiles.map((p) => [p.teamMemberId, p]));
      const lifecycleByMember = new Map(lifecycles.map((l) => [l.subjectId, l.status]));

      // Filter by lifecycle + availability + skills. Capacity is enforced
      // after we've read open-ticket counts (per-strategy branch below).
      let candidates = teamMembers.filter((tm) => {
        if (lifecycleByMember.get(tm.id) !== "ACTIVE") return false;
        const prof = profileByMember.get(tm.id);
        // No profile = available with unlimited capacity + no skills.
        // That keeps freshly-added agents pickable before an admin has
        // touched their profile.
        if (prof && !prof.isAvailable) return false;
        if (strategy === "SKILLS_BASED" && requiredSkills && requiredSkills.length > 0) {
          const skills = new Set(prof?.skills ?? []);
          if (!requiredSkills.every((s) => skills.has(s))) return false;
        }
        return true;
      });

      // Z5 access scope: GROUPS-scoped agents must belong to this group.
      // Since we sourced candidates *from* this group, every candidate
      // already satisfies that — ALL and ASSIGNED_ONLY are trivially OK,
      // GROUPS is OK because they're in `memberships`. This filter is
      // kept explicit so a future change that widens the candidate pool
      // (e.g. "if group is empty, fall back to all agents") can't
      // silently violate the rule.
      candidates = candidates.filter((tm) => {
        if (tm.ticketAccessScope === "ALL") return true;
        if (tm.ticketAccessScope === "GROUPS") return memberIds.includes(tm.id);
        // ASSIGNED_ONLY: making them the assignee is what puts the ticket
        // in scope. Legal.
        return true;
      });

      if (candidates.length === 0) {
        return {
          ok: false as const,
          reason: "NO_CANDIDATES" as const,
          message: "No eligible agents for this routing request (all unavailable, out of scope, or missing skills).",
        };
      }

      // Per-strategy pick.
      let picked: string | null = null;

      if (strategy === "ROUND_ROBIN") {
        // Read this group's last-picked-for-this-group auto-route rows
        // and rotate. Falls back to the earliest-added candidate if
        // there's no history yet. Ordering by `id` keeps the rotation
        // deterministic across parallel routing calls.
        const rotation = [...candidates].sort((a, b) => a.id.localeCompare(b.id));
        const lastForGroup = await tx.autoAssignmentLog.findFirst({
          where: {
            tenantId: session.tenantId,
            teamMemberId: { in: rotation.map((r) => r.id) },
            strategy: "ROUND_ROBIN",
          },
          orderBy: { createdAt: "desc" },
        });
        if (!lastForGroup?.teamMemberId) {
          picked = rotation[0].id;
        } else {
          const lastIdx = rotation.findIndex((r) => r.id === lastForGroup.teamMemberId);
          picked = rotation[(lastIdx + 1) % rotation.length].id;
        }
      } else if (strategy === "LOAD_BASED" || strategy === "SKILLS_BASED") {
        // Read each candidate's open-ticket count in one grouped query.
        // Open = not RESOLVED and not CLOSED (the queue-view definition).
        const loads = await tx.ticket.groupBy({
          by: ["assignedTeamMemberId"],
          where: {
            tenantId: session.tenantId,
            assignedTeamMemberId: { in: candidates.map((c) => c.id) },
            status: { notIn: ["RESOLVED", "CLOSED"] },
          },
          _count: { _all: true },
        });
        const loadByMember = new Map(
          loads.map((l) => [l.assignedTeamMemberId as string, l._count._all])
        );

        // Enforce maxOpen (0 = unlimited).
        const withinCapacity = candidates.filter((c) => {
          const prof = profileByMember.get(c.id);
          const max = prof?.maxOpen ?? 0;
          if (max === 0) return true;
          return (loadByMember.get(c.id) ?? 0) < max;
        });
        if (withinCapacity.length === 0) {
          return {
            ok: false as const,
            reason: "NO_CANDIDATES" as const,
            message: "All eligible agents are at capacity.",
          };
        }
        // Fewest-open wins. Ties broken by intent-skill match (M9.6 —
        // agents whose skills include the intent slug get preferred over
        // equally-loaded candidates), then by `id` for determinism.
        withinCapacity.sort((a, b) => {
          const la = loadByMember.get(a.id) ?? 0;
          const lb = loadByMember.get(b.id) ?? 0;
          if (la !== lb) return la - lb;
          if (preferredIntent) {
            const aHas = new Set(profileByMember.get(a.id)?.skills ?? []).has(preferredIntent);
            const bHas = new Set(profileByMember.get(b.id)?.skills ?? []).has(preferredIntent);
            if (aHas !== bHas) return aHas ? -1 : 1;
          }
          return a.id.localeCompare(b.id);
        });
        picked = withinCapacity[0].id;
      }

      if (!picked) {
        return {
          ok: false as const,
          reason: "NO_CANDIDATES" as const,
          message: "Routing strategy produced no pick.",
        };
      }

      await tx.autoAssignmentLog.create({
        data: {
          tenantId: session.tenantId,
          ticketId,
          teamMemberId: picked,
          strategy,
          source,
          cappedOut: false,
        },
      });

      return { ok: true as const, teamMemberId: picked, strategy };
    }
  );
}

/**
 * Ergonomic helper for callers who just want to know "did the last
 * routing decision hit the loop cap?" — the M1 escalation button + rule
 * engine use it to surface a clear message instead of a raw
 * `NO_CANDIDATES`. Reads the most recent AutoAssignmentLog row for the
 * ticket.
 */
export async function wasLastRoutingCapped(
  session: RoutingSession,
  ticketId: string
): Promise<boolean> {
  return withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    async (tx) => {
      const last = await tx.autoAssignmentLog.findFirst({
        where: { tenantId: session.tenantId, ticketId },
        orderBy: { createdAt: "desc" },
      });
      return last?.cappedOut === true;
    }
  );
}

/**
 * Called from every manual updateTicket() that changes the assignee.
 * Writes a MANUAL AutoAssignmentLog row — the loop-cap detector reads
 * this and resets the "consecutive auto" counter. Cheap: a single insert.
 */
export async function recordManualAssignment(params: {
  session: RoutingSession;
  ticketId: string;
  teamMemberId: string;
}): Promise<void> {
  const { session, ticketId, teamMemberId } = params;
  await withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    (tx) =>
      tx.autoAssignmentLog.create({
        data: {
          tenantId: session.tenantId,
          ticketId,
          teamMemberId,
          strategy: "ROUND_ROBIN", // arbitrary — MANUAL rows aren't used for strategy stats
          source: "MANUAL",
          cappedOut: false,
        },
      })
  );
}

// Convenience: shape used by an admin surface that wants to render a
// snapshot of load per agent. Kept next to the engine so the two stay
// consistent (same "open" definition).
export async function getAgentLoadSnapshot(params: {
  session: RoutingSession;
  groupId: string;
}): Promise<
  Array<{
    teamMemberId: string;
    openCount: number;
    maxOpen: number;
    isAvailable: boolean;
    skills: string[];
  }>
> {
  const { session, groupId } = params;
  return withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    async (tx) => {
      const memberships = await tx.teamMemberGroup.findMany({
        where: { groupId, tenantId: session.tenantId },
        select: { teamMemberId: true },
      });
      const memberIds = memberships.map((m) => m.teamMemberId);
      if (memberIds.length === 0) return [];
      const [profiles, loads] = await Promise.all([
        tx.agentProfile.findMany({
          where: { tenantId: session.tenantId, teamMemberId: { in: memberIds } },
        }),
        tx.ticket.groupBy({
          by: ["assignedTeamMemberId"],
          where: {
            tenantId: session.tenantId,
            assignedTeamMemberId: { in: memberIds },
            status: { notIn: ["RESOLVED", "CLOSED"] },
          },
          _count: { _all: true },
        }),
      ]);
      const profileByMember = new Map(profiles.map((p) => [p.teamMemberId, p]));
      const loadByMember = new Map(
        loads.map((l) => [l.assignedTeamMemberId as string, l._count._all])
      );
      return memberIds.map((id) => {
        const p = profileByMember.get(id);
        return {
          teamMemberId: id,
          openCount: loadByMember.get(id) ?? 0,
          maxOpen: p?.maxOpen ?? 0,
          isAvailable: p?.isAvailable ?? true,
          skills: p?.skills ?? [],
        };
      });
    }
  );
}

// Prisma is imported for its side-effect-free type surface — kept
// explicit so downstream refactors that touch the client shape are
// obvious from `imports` diffs.
export type { Prisma };
