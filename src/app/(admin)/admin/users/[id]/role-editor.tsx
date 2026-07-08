"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  changeTeamMemberRoleById,
  promoteToSuperAdmin,
} from "@/actions/admin";
import { Select } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";

// Z5.4 — role management for a team member. Combines two affordances:
// (1) a dynamic Role dropdown listing every wrapper Role on the tenant
// (Standard + Custom, grouped via <optgroup>) minus "Super Admin";
// (2) a separate "Promote to Super Admin" button, visible only when the
// acting session is itself SUPER_ADMIN — matches Zendesk's "transfer
// ownership" pattern where SA is a bootstrap identity, not a role you
// grant from the same picker.

type RoleOption = {
  id: string;
  name: string;
  isCustom: boolean;
};

export function RoleEditor({
  teamMemberId,
  initialRoleId,
  initialRoleName,
  roles,
  disabled,
  canPromoteToSuperAdmin,
}: {
  teamMemberId: string;
  initialRoleId: string;
  initialRoleName: string;
  roles: RoleOption[];
  disabled?: boolean;
  canPromoteToSuperAdmin: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [roleId, setRoleId] = useState(initialRoleId);
  const [pending, startTransition] = useTransition();
  const [promoteOpen, setPromoteOpen] = useState(false);

  // Filter Super Admin out of the picker — it has its own promote path.
  const assignable = roles.filter((r) => r.name !== "Super Admin");
  const standard = assignable.filter((r) => !r.isCustom);
  const custom = assignable.filter((r) => r.isCustom);

  function onChange(next: string) {
    if (next === roleId || pending) return;
    const prev = roleId;
    setRoleId(next);
    startTransition(async () => {
      try {
        const res = await changeTeamMemberRoleById({ userId: teamMemberId, roleId: next });
        toast({ title: `Role changed to ${res.toRoleName}`, variant: "success" });
        router.refresh();
      } catch (e) {
        setRoleId(prev);
        toast({
          title: "Couldn't change role",
          description: e instanceof Error ? e.message : undefined,
          variant: "error",
        });
      }
    });
  }

  function doPromote() {
    startTransition(async () => {
      try {
        await promoteToSuperAdmin(teamMemberId);
        setPromoteOpen(false);
        toast({ title: "Promoted to Super Admin", variant: "success" });
        router.refresh();
      } catch (e) {
        toast({
          title: "Couldn't promote",
          description: e instanceof Error ? e.message : undefined,
          variant: "error",
        });
      }
    });
  }

  const isSuperAdmin = initialRoleName === "Super Admin";

  return (
    <div className="bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl p-5">
      <h3 className="text-sm font-semibold mb-1">Role</h3>
      <p className="text-[12px] text-[var(--color-neutral-500)] mb-3">
        Determines what this person can do. Standard roles are managed by the
        system; custom roles come from the Roles page.
      </p>

      {isSuperAdmin ? (
        <div className="rounded-lg border border-[var(--color-neutral-300)] bg-[var(--color-neutral-50)] dark:bg-white/[0.04] px-3 py-2 text-[13px]">
          <span className="font-semibold">Super Admin.</span>{" "}
          <span className="text-[var(--color-neutral-500)]">
            Change requires a separate demotion by another Super Admin.
          </span>
        </div>
      ) : (
        <Select
          value={roleId}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled || pending}
        >
          <optgroup label="Standard">
            {standard.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </optgroup>
          {custom.length > 0 && (
            <optgroup label="Custom">
              {custom.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </optgroup>
          )}
        </Select>
      )}

      {canPromoteToSuperAdmin && !isSuperAdmin && (
        <>
          <div className="mt-4 pt-4 border-t border-[var(--color-neutral-200)]">
            <Button
              variant="secondary"
              onClick={() => setPromoteOpen(true)}
              disabled={pending}
              className="w-full"
            >
              Promote to Super Admin
            </Button>
            <p className="text-[11px] text-[var(--color-neutral-500)] mt-2 leading-snug">
              Additive — doesn&apos;t demote the current Super Admin. Only
              Super Admins can grant this role.
            </p>
          </div>

          <Modal
            open={promoteOpen}
            onClose={() => setPromoteOpen(false)}
            title="Promote to Super Admin?"
          >
            <p className="text-[13px] text-[var(--color-neutral-700)] mb-2">
              Super Admins have full access to every tenant surface, including
              tenant settings, impersonation, and role management. This is a
              highly privileged role — only grant it to someone you fully
              trust.
            </p>
            <p className="text-[13px] text-[var(--color-neutral-700)] mb-4">
              You will remain a Super Admin. To later remove Super Admin from
              someone, use the standard demotion flow from the roles page.
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setPromoteOpen(false)}>
                Cancel
              </Button>
              <Button onClick={doPromote} disabled={pending}>
                {pending ? "Promoting…" : "Promote"}
              </Button>
            </div>
          </Modal>
        </>
      )}
    </div>
  );
}
