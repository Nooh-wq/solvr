"use server";

// M21.1 — self-service user preferences (timezone / language, and columns
// for theme / density / defaultLanding reserved for M21.5). Support-owned
// SubjectPreference table, same shape as SubjectAvatar (Z1.7).

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withRls } from "@/lib/db";
import { requireSession } from "@/lib/auth";

export type PreferencesDto = {
  timezone: string | null;
  language: string | null;
  theme: string | null;
  density: string | null;
  defaultLanding: string | null;
};

const EMPTY_PREFS: PreferencesDto = {
  timezone: null,
  language: null,
  theme: null,
  density: null,
  defaultLanding: null,
};

export async function getMyPreferences(): Promise<PreferencesDto> {
  const session = await requireSession();
  const row = await withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    (tx) =>
      tx.subjectPreference.findUnique({
        where: { subjectId: session.subjectId },
        select: {
          timezone: true,
          language: true,
          theme: true,
          density: true,
          defaultLanding: true,
        },
      })
  );
  return row ?? EMPTY_PREFS;
}

// timezone/language stay loose (IANA/BCP-47 strings). theme/density/
// defaultLanding are enum-constrained now that M21.5 owns those toggles
// — invalid values are rejected rather than round-tripped through the DB.
const updatePreferencesSchema = z.object({
  timezone: z.string().max(64).nullable().optional(),
  language: z.string().max(16).nullable().optional(),
  theme: z.enum(["light", "dark", "system"]).nullable().optional(),
  density: z.enum(["regular", "compact"]).nullable().optional(),
  // Kept as free string with a max — the valid options depend on the
  // caller's role (a CLIENT can't default-land on /admin). The runtime
  // check lives in getPostLoginRedirect() so a stale preference is
  // silently ignored rather than throwing.
  defaultLanding: z.string().max(64).nullable().optional(),
});

export async function updateMyPreferences(input: z.infer<typeof updatePreferencesSchema>) {
  const session = await requireSession();
  const data = updatePreferencesSchema.parse(input);
  await withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    (tx) =>
      tx.subjectPreference.upsert({
        where: { subjectId: session.subjectId },
        create: { subjectId: session.subjectId, tenantId: session.tenantId, ...data },
        update: data,
      })
  );
  revalidatePath("/", "layout");
  return { ok: true as const };
}
