"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import {
  systemContext,
  listRoles,
  createRole,
  updateRole,
  deleteRole,
} from "@/lib/shared-platform";
import { ALL_PERMISSION_KEYS } from "@/lib/permissions";

// Z5.4 — Support-side thin wrapper around the wrapper's Role CRUD.
// The wrapper enforces STANDARD_ROLE_MODIFY / ROLE_IN_USE / uniqueness;
// we add the app-layer auth check (ADMIN+) and revalidate the /admin/roles
// surface after each mutation. The Role.permissions Json blob is validated
// against the current permission-category catalog so a role can't store
// an unknown key that later renders as ambiguous or disappears from the UI.

const createRoleSchema = z.object({
  name: z.string().min(1).max(60),
  permissions: z.record(z.string(), z.boolean()).default({}),
});

const updateRoleSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(60).optional(),
  permissions: z.record(z.string(), z.boolean()).optional(),
});

function sanitizePermissions(input: Record<string, boolean>): Record<string, boolean> {
  const allowed = new Set(ALL_PERMISSION_KEYS);
  const out: Record<string, boolean> = {};
  for (const key of ALL_PERMISSION_KEYS) out[key] = false;
  for (const [k, v] of Object.entries(input)) {
    if (allowed.has(k)) out[k] = Boolean(v);
  }
  return out;
}

export async function listRolesForAdmin() {
  const session = await requireSession({ minRole: "ADMIN" });
  const ctx = systemContext(session.tenantId);
  return listRoles(ctx);
}

export async function createCustomRole(input: z.infer<typeof createRoleSchema>) {
  const session = await requireSession({ minRole: "ADMIN" });
  const data = createRoleSchema.parse(input);
  const ctx = systemContext(session.tenantId);
  const permissions = sanitizePermissions(data.permissions);
  const role = await createRole(ctx, { name: data.name, permissions });
  revalidatePath("/admin/roles");
  return role;
}

export async function updateCustomRole(input: z.infer<typeof updateRoleSchema>) {
  const session = await requireSession({ minRole: "ADMIN" });
  const data = updateRoleSchema.parse(input);
  const ctx = systemContext(session.tenantId);
  const role = await updateRole(ctx, data.id, {
    name: data.name,
    permissions: data.permissions ? sanitizePermissions(data.permissions) : undefined,
  });
  revalidatePath("/admin/roles");
  return role;
}

export async function deleteCustomRole(id: string) {
  const session = await requireSession({ minRole: "ADMIN" });
  const ctx = systemContext(session.tenantId);
  await deleteRole(ctx, id);
  revalidatePath("/admin/roles");
  return { ok: true };
}
