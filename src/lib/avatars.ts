// Support-owned avatar lookup layer.
//
// Z1.7 lands the SubjectAvatar table on the Support side rather than
// widening the wrapper's EndUser/TeamMember DTOs — Shared Platform is
// externally owned, and the Set B precedent (AuthCredential, *Lifecycle)
// already treats UI/auth concerns as Support-owned. See
// docs/shared-platform-boundary.md §7.10.
//
// This module is intentionally NOT in src/lib/shared-platform/: that
// module wraps the WRAPPER's Prisma models. SubjectAvatar is a
// Support-owned table.

import { withRls } from "@/lib/db";

/**
 * Batch-fetch avatar URLs for a set of subject ids (EndUser or
 * TeamMember — both share the same subjectId space thanks to Z1.3
 * preserved-ids). Returns a Map keyed on subjectId; a missing key
 * means "no avatar set" (UI falls back to initials).
 *
 * Opens its own tenant-scoped RLS transaction — mirrors the wrapper
 * helpers' contract of "self-contained; no shared tx required."
 * Callers typically await this in parallel with getEndUsersByIds and
 * getTeamMembersByIds.
 */
export async function getAvatarUrlsByIds(
  tenantId: string,
  ids: string[]
): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const rows = await withRls(
    { tenantId, userId: null, role: "SUPER_ADMIN" },
    (tx) =>
      tx.subjectAvatar.findMany({
        where: { tenantId, subjectId: { in: ids } },
        select: { subjectId: true, avatarUrl: true },
      })
  );
  return new Map(rows.map((r) => [r.subjectId, r.avatarUrl]));
}

/** Single-subject variant — used by getSessionUser. */
export async function getAvatarUrl(
  tenantId: string,
  subjectId: string
): Promise<string | null> {
  const row = await withRls(
    { tenantId, userId: subjectId },
    (tx) =>
      tx.subjectAvatar.findUnique({
        where: { subjectId },
        select: { avatarUrl: true },
      })
  );
  return row?.avatarUrl ?? null;
}
