"use client";

import { useState, useTransition } from "react";
import { setTenantMfaEnforcement } from "@/actions/tenantSecurity";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";

export function SecuritySettingsForm({
  initial,
}: {
  initial: { enforceMfa: boolean; callerHasMfa: boolean };
}) {
  const { toast } = useToast();
  const [enforceMfa, setEnforceMfa] = useState(initial.enforceMfa);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function toggle() {
    const next = !enforceMfa;
    setError(null);
    startTransition(async () => {
      const r = await setTenantMfaEnforcement({ enabled: next });
      if (!r.ok) {
        setError(r.error);
        toast({ title: "Couldn't update", description: r.error, variant: "error" });
        return;
      }
      setEnforceMfa(next);
      toast({
        title: next ? "2FA is now required" : "2FA requirement removed",
        description: next
          ? "Every user in this tenant must enroll on next sign-in."
          : "Users who enrolled 2FA keep it. New users are no longer forced.",
        variant: "success",
      });
    });
  }

  // Enabling requires the caller has MFA — otherwise they lock themselves
  // out on next sign-in. Disabling has no such guard.
  const enableBlocked = !enforceMfa && !initial.callerHasMfa;

  return (
    <div className="max-w-xl">
      <div className="bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl p-6 space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-[15px] font-semibold flex items-center gap-2">
              Require two-factor authentication
              {enforceMfa && (
                <span className="text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded-md bg-[var(--color-primary)]/10 text-[var(--color-primary)]">
                  Enforced
                </span>
              )}
            </h2>
            <p className="text-[13px] text-[var(--color-neutral-600)] mt-1">
              When on, every user must enroll TOTP before their session is issued. Users who already
              enrolled sign in normally.
            </p>
          </div>
          <Button
            type="button"
            variant={enforceMfa ? "secondary" : "primary"}
            size="sm"
            disabled={pending || enableBlocked}
            onClick={toggle}
          >
            {pending ? "Updating…" : enforceMfa ? "Turn off" : "Turn on"}
          </Button>
        </div>
        {enableBlocked && (
          <p className="text-[13px] rounded-lg border border-yellow-300/60 dark:border-yellow-500/30 bg-yellow-50/60 dark:bg-yellow-500/5 text-yellow-800 dark:text-yellow-300 px-3 py-2">
            You need to enable 2FA on your own account first — otherwise turning this on would lock
            you out on your next sign-in. Head to Account → Security to enroll.
          </p>
        )}
        {error && <p className="text-[13px] text-red-600">{error}</p>}
      </div>
    </div>
  );
}
