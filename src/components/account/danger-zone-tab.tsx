"use client";

// M21.6 — Danger Zone tab.
//   * Data export: queues an Inngest job that packages tickets/messages/
//     preferences into JSON and emails a signed 72-hour link. Recent
//     requests are listed with their status.
//   * Deactivate: immediate — flips lifecycle to SUSPENDED and revokes
//     every UserSession row for the caller. Last-Super-Admin protection
//     applies for staff.
//   * Delete: creates a PENDING request for the admin queue. Also gated
//     by the last-Super-Admin check.

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  requestDataExport,
  selfDeactivateAccount,
  requestAccountDeletion,
  listMyDataExports,
  myPendingDeletionRequest,
  type DataExportRequestSummary,
} from "@/actions/dangerZone";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";

export function DangerZoneTab() {
  return (
    <div className="space-y-6 max-w-xl">
      <DataExportCard />
      <DeactivateCard />
      <DeleteCard />
    </div>
  );
}

function DataExportCard() {
  const { toast } = useToast();
  const [exports, setExports] = useState<DataExportRequestSummary[] | null>(null);
  const [pending, startTransition] = useTransition();

  async function refresh() {
    setExports(await listMyDataExports());
  }
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    refresh();
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  function submit() {
    startTransition(async () => {
      const result = await requestDataExport();
      if ("error" in result) {
        toast({ title: "Couldn't queue export", description: result.error, variant: "error" });
        return;
      }
      toast({
        title: "Export queued",
        description: "You'll get an email with a 72-hour download link when it's ready.",
        variant: "success",
      });
      await refresh();
    });
  }

  return (
    <div className="bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl p-6 space-y-4">
      <div>
        <h2 className="text-[15px] font-semibold">Export your data</h2>
        <p className="text-[13px] text-[var(--color-neutral-600)] mt-1">
          Get every ticket, message, and preference tied to your account as a JSON file.
          The download link expires 72 hours after it&apos;s ready.
        </p>
      </div>
      <Button onClick={submit} disabled={pending}>
        {pending ? "Queuing…" : "Request export"}
      </Button>
      {exports && exports.length > 0 && (
        <ul className="divide-y divide-[var(--color-neutral-200)] dark:divide-white/10 -mx-2">
          {exports.map((e) => (
            <li key={e.id} className="px-2 py-2.5 flex items-center justify-between">
              <div>
                <div className="text-[13px] font-medium">
                  {e.status === "PENDING"
                    ? "Preparing…"
                    : e.status === "READY"
                      ? "Ready"
                      : e.status}
                </div>
                <div className="text-[11px] text-[var(--color-neutral-500)]">
                  Requested {e.createdAt.toLocaleString()}
                  {e.expiresAt && ` · expires ${e.expiresAt.toLocaleString()}`}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function DeactivateCard() {
  const { toast } = useToast();
  const router = useRouter();
  const [confirm, setConfirm] = useState(false);
  const [pending, startTransition] = useTransition();

  function submit() {
    startTransition(async () => {
      const result = await selfDeactivateAccount();
      if ("error" in result) {
        toast({ title: "Couldn't deactivate", description: result.error, variant: "error" });
        return;
      }
      toast({
        title: "Account deactivated",
        description: "You've been signed out.",
        variant: "success",
      });
      router.push("/auth/login");
    });
  }

  return (
    <div className="bg-[var(--color-surface)] border border-yellow-300/60 dark:border-yellow-500/30 rounded-2xl p-6 space-y-4">
      <div>
        <h2 className="text-[15px] font-semibold text-yellow-700 dark:text-yellow-400">
          Deactivate account
        </h2>
        <p className="text-[13px] text-[var(--color-neutral-600)] mt-1">
          Signs you out on every device and marks your account inactive. You can be reactivated
          by an admin — this is not the same as deleting.
        </p>
      </div>
      {!confirm ? (
        <Button variant="secondary" onClick={() => setConfirm(true)} disabled={pending}>
          Deactivate
        </Button>
      ) : (
        <div className="flex gap-2">
          <Button onClick={submit} disabled={pending} className="bg-yellow-600 hover:bg-yellow-700 text-white">
            {pending ? "Deactivating…" : "Yes, deactivate"}
          </Button>
          <Button variant="secondary" onClick={() => setConfirm(false)} disabled={pending}>
            Cancel
          </Button>
        </div>
      )}
    </div>
  );
}

function DeleteCard() {
  const { toast } = useToast();
  const [existing, setExisting] = useState<{ id: string; createdAt: Date } | null>(null);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [pending, startTransition] = useTransition();

  async function refresh() {
    setExisting(await myPendingDeletionRequest());
  }
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    refresh();
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  function submit() {
    startTransition(async () => {
      const result = await requestAccountDeletion({ reason });
      if ("error" in result) {
        toast({ title: "Couldn't submit", description: result.error, variant: "error" });
        return;
      }
      toast({
        title: "Deletion request submitted",
        description: "An admin will review it.",
        variant: "success",
      });
      setOpen(false);
      setReason("");
      await refresh();
    });
  }

  return (
    <div className="bg-[var(--color-surface)] border border-red-300/60 dark:border-red-500/30 rounded-2xl p-6 space-y-4">
      <div>
        <h2 className="text-[15px] font-semibold text-red-700 dark:text-red-400">
          Delete account
        </h2>
        <p className="text-[13px] text-[var(--color-neutral-600)] mt-1">
          Request permanent deletion. An admin has to approve — no data is removed until they do.
        </p>
      </div>

      {existing ? (
        <p className="text-[13px] rounded-lg border border-[var(--color-neutral-300)] px-3 py-2 text-[var(--color-neutral-700)]">
          Request pending since {new Date(existing.createdAt).toLocaleString()}.
        </p>
      ) : !open ? (
        <Button variant="secondary" onClick={() => setOpen(true)} className="text-red-700 dark:text-red-400 border-red-300/60">
          Request deletion
        </Button>
      ) : (
        <div className="space-y-3">
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Optional — tell the admin why."
            rows={3}
            className="w-full px-3 py-2 rounded-lg border border-[var(--color-neutral-300)] bg-[var(--color-surface)] text-[13px] text-[var(--foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] resize-y"
          />
          <div className="flex gap-2">
            <Button onClick={submit} disabled={pending} className="bg-red-600 hover:bg-red-700 text-white">
              {pending ? "Submitting…" : "Submit request"}
            </Button>
            <Button variant="secondary" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
