"use server";

// M21.4 — session-guarded get/set thin wrappers over lib/notification-prefs.
// The underlying helpers are used by both the tab UI (through here) AND
// by every gated email/notify site (directly), which is why the storage
// layer lives in a plain lib module rather than a "use server" file.

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth";
import {
  readMyPreferences,
  writeMyPreferences,
  type NotificationPreferencesDto,
} from "@/lib/notification-prefs";

export async function getMyNotificationPreferences(): Promise<NotificationPreferencesDto> {
  const session = await requireSession();
  return readMyPreferences(session.tenantId, session.subjectId);
}

export async function updateMyNotificationPreferences(patch: Partial<NotificationPreferencesDto>) {
  const session = await requireSession();
  // Whitelist the columns callers can touch — belt-and-suspenders against
  // a client passing e.g. tenantId in the patch.
  const allowed: Partial<NotificationPreferencesDto> = {};
  const keys: (keyof NotificationPreferencesDto)[] = [
    "emailTicketCreated",
    "emailTicketReply",
    "emailStatusChange",
    "emailAssigned",
    "emailCsatRequest",
    "inAppTicketReply",
    "inAppStatusChange",
    "inAppAssigned",
    "digestMode",
  ];
  for (const k of keys) {
    if (k in patch) (allowed as Record<string, unknown>)[k] = patch[k];
  }
  if (allowed.digestMode !== undefined && !["INSTANT", "DAILY"].includes(allowed.digestMode)) {
    return { error: "Invalid digest mode." as const };
  }
  await writeMyPreferences(session.tenantId, session.subjectId, allowed);
  revalidatePath("/", "layout");
  return { ok: true as const };
}
