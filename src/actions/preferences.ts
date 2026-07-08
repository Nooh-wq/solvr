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

// Loose validation on purpose — M21.1 accepts whatever IANA/BCP-47 string
// the browser hands us; the Appearance tab in M21.5 will constrain the
// theme/density/defaultLanding enum values.
const updatePreferencesSchema = z.object({
  timezone: z.string().max(64).nullable().optional(),
  language: z.string().max(16).nullable().optional(),
  theme: z.string().max(16).nullable().optional(),
  density: z.string().max(16).nullable().optional(),
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
