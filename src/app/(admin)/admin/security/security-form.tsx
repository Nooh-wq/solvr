"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import {
  setTenantMfaEnforcement,
  setTenantSsoEnforcement,
} from "@/actions/tenantSecurity";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";

export function SecuritySettingsForm({
  initial,
}: {
  initial: {
    enforceMfa: boolean;
    enforceSso: boolean;
    callerHasMfa: boolean;
    breakGlassCount: number;
    activeIdpKinds: string[];
  };
}) {
  const { toast } = useToast();
  const [enforceMfa, setEnforceMfa] = useState(initial.enforceMfa);
  const [enforceSso, setEnforceSso] = useState(initial.enforceSso);
  const [pending, startTransition] = useTransition();
  const [mfaError, setMfaError] = useState<string | null>(null);
  const [ssoError, setSsoError] = useState<string | null>(null);

  function toggleMfa() {
    const next = !enforceMfa;
    setMfaError(null);
    startTransition(async () => {
      const r = await setTenantMfaEnforcement({ enabled: next });
      if (!r.ok) {
        setMfaError(r.error);
        toast({ title: "Couldn't update", description: r.error, variant: "error" });
        return;
      }
      setEnforceMfa(next);
      toast({
        title: next ? "2FA is now required" : "2FA requirement removed",
        variant: "success",
      });
    });
  }

  function toggleSso() {
    const next = !enforceSso;
    setSsoError(null);
    startTransition(async () => {
      const r = await setTenantSsoEnforcement({ enabled: next });
      if (!r.ok) {
        setSsoError(r.error);
        toast({ title: "Couldn't update", description: r.error, variant: "error" });
        return;
      }
      setEnforceSso(next);
      toast({
        title: next ? "SSO is now required" : "SSO requirement removed",
        variant: "success",
      });
    });
  }

  const mfaEnableBlocked = !enforceMfa && !initial.callerHasMfa;
  const ssoEnableBlocked =
    !enforceSso &&
    (initial.breakGlassCount === 0 || initial.activeIdpKinds.length === 0);

  return (
    <div className="max-w-xl space-y-6">
      {/* 2FA enforcement */}
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
              When on, every user must enroll TOTP before their session is issued.
            </p>
          </div>
          <Button
            type="button"
            variant={enforceMfa ? "secondary" : "primary"}
            size="sm"
            disabled={pending || mfaEnableBlocked}
            onClick={toggleMfa}
          >
            {pending ? "Updating…" : enforceMfa ? "Turn off" : "Turn on"}
          </Button>
        </div>
        {mfaEnableBlocked && (
          <p className="text-[13px] rounded-lg border border-yellow-300/60 dark:border-yellow-500/30 bg-yellow-50/60 dark:bg-yellow-500/5 text-yellow-800 dark:text-yellow-300 px-3 py-2">
            Enable 2FA on your own account first — otherwise turning this on locks you out. Head to Account → Security.
          </p>
        )}
        {mfaError && <p className="text-[13px] text-red-600">{mfaError}</p>}
      </div>

      {/* SSO enforcement */}
      <div className="bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl p-6 space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-[15px] font-semibold flex items-center gap-2">
              Require SSO
              {enforceSso && (
                <span className="text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded-md bg-[var(--color-primary)]/10 text-[var(--color-primary)]">
                  Enforced
                </span>
              )}
            </h2>
            <p className="text-[13px] text-[var(--color-neutral-600)] mt-1">
              When on, email/password is disabled tenant-wide. Only your IdP and break-glass admins can sign in.
            </p>
          </div>
          <Button
            type="button"
            variant={enforceSso ? "secondary" : "primary"}
            size="sm"
            disabled={pending || ssoEnableBlocked}
            onClick={toggleSso}
          >
            {pending ? "Updating…" : enforceSso ? "Turn off" : "Turn on"}
          </Button>
        </div>
        <div className="text-[12px] text-[var(--color-neutral-600)] space-y-1">
          <div>Active identity providers: {initial.activeIdpKinds.length > 0 ? initial.activeIdpKinds.join(", ") : "none"}</div>
          <div>Break-glass Super Admins: {initial.breakGlassCount}</div>
        </div>
        {ssoEnableBlocked && (
          <p className="text-[13px] rounded-lg border border-yellow-300/60 dark:border-yellow-500/30 bg-yellow-50/60 dark:bg-yellow-500/5 text-yellow-800 dark:text-yellow-300 px-3 py-2">
            You need at least one active identity provider AND at least one break-glass Super Admin before enforcing SSO. Configure them in <Link href="/admin/identity-providers" className="underline">Identity providers</Link>.
          </p>
        )}
        {ssoError && <p className="text-[13px] text-red-600">{ssoError}</p>}
      </div>

      <div className="text-[12px] text-[var(--color-neutral-500)]">
        <Link href="/admin/identity-providers" className="hover:underline">
          Configure identity providers →
        </Link>
      </div>
    </div>
  );
}
