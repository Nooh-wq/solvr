"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  updateRetentionPolicy,
  setHipaaEnabled,
  configureByok,
  shredTenantEncryptionKey,
} from "@/actions/compliance";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";

type Status = {
  residencyRegion: string;
  hipaaEnabled: boolean;
  kmsMode: "PLATFORM" | "BYOK" | null;
  kmsKeyRef: string | null;
  shreddedAt: string | null;
  retention: { tickets: number | null; messages: number | null; auditLogs: number | null };
};

function nOrNull(s: string): number | null {
  if (s.trim() === "") return null;
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

export function ComplianceEditor({ status }: { status: Status }) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [tickets, setTickets] = useState(status.retention.tickets?.toString() ?? "");
  const [messages, setMessages] = useState(status.retention.messages?.toString() ?? "");
  const [audit, setAudit] = useState(status.retention.auditLogs?.toString() ?? "");
  const [hipaa, setHipaa] = useState(status.hipaaEnabled);
  const [kmsMode, setKmsMode] = useState<"PLATFORM" | "BYOK">(status.kmsMode ?? "PLATFORM");
  const [kmsKeyRef, setKmsKeyRef] = useState(status.kmsKeyRef ?? "");
  const [shredToken, setShredToken] = useState("");

  const shredded = !!status.shreddedAt;

  function saveRetention() {
    startTransition(async () => {
      try {
        await updateRetentionPolicy({
          retentionTicketsDays: nOrNull(tickets),
          retentionMessagesDays: nOrNull(messages),
          retentionAuditLogsDays: nOrNull(audit),
        });
        toast({ title: "Retention updated", variant: "success" });
        router.refresh();
      } catch (e) {
        toast({
          title: "Update failed",
          description: e instanceof Error ? e.message : undefined,
          variant: "error",
        });
      }
    });
  }
  function toggleHipaa() {
    startTransition(async () => {
      try {
        await setHipaaEnabled(!hipaa);
        setHipaa(!hipaa);
        toast({ title: !hipaa ? "HIPAA mode enabled" : "HIPAA mode disabled", variant: "success" });
      } catch (e) {
        toast({
          title: "Update failed",
          description: e instanceof Error ? e.message : undefined,
          variant: "error",
        });
      }
    });
  }
  function saveByok() {
    startTransition(async () => {
      try {
        await configureByok({ kmsMode, kmsKeyRef: kmsMode === "BYOK" ? kmsKeyRef : null });
        toast({ title: "BYOK updated", variant: "success" });
        router.refresh();
      } catch (e) {
        toast({
          title: "Update failed",
          description: e instanceof Error ? e.message : undefined,
          variant: "error",
        });
      }
    });
  }
  function doShred() {
    if (!confirm("Crypto-shred the tenant key? This is IRREVERSIBLE — every encrypted value becomes unreadable.")) return;
    startTransition(async () => {
      try {
        await shredTenantEncryptionKey(shredToken);
        toast({ title: "Key shredded", variant: "success" });
        router.refresh();
      } catch (e) {
        toast({
          title: "Shred failed",
          description: e instanceof Error ? e.message : undefined,
          variant: "error",
        });
      }
    });
  }

  return (
    <div className="space-y-6">
      <section className="bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl p-5">
        <h2 className="text-[15px] font-semibold mb-1">Residency</h2>
        <p className="text-[12px] text-[var(--color-neutral-600)] mb-2">
          This tenant is pinned to region <b>{status.residencyRegion}</b>. Region moves are a
          support request — every query on cross-region deployments is refused at the auth boundary.
        </p>
      </section>

      <section className="bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl p-5">
        <h2 className="text-[15px] font-semibold mb-3">Retention</h2>
        <p className="text-[12px] text-[var(--color-neutral-600)] mb-3">
          Days to retain data before the nightly sweep deletes it. Leave blank to keep forever.
        </p>
        <div className="grid grid-cols-3 gap-3">
          <label className="block">
            <span className="block text-[11px] uppercase-label mb-1">Closed tickets</span>
            <Input value={tickets} onChange={(e) => setTickets(e.target.value)} placeholder="e.g. 365" />
          </label>
          <label className="block">
            <span className="block text-[11px] uppercase-label mb-1">Messages</span>
            <Input value={messages} onChange={(e) => setMessages(e.target.value)} placeholder="e.g. 365" />
          </label>
          <label className="block">
            <span className="block text-[11px] uppercase-label mb-1">Audit logs</span>
            <Input value={audit} onChange={(e) => setAudit(e.target.value)} placeholder="e.g. 1825" />
          </label>
        </div>
        <div className="mt-3">
          <Button size="sm" disabled={pending} onClick={saveRetention}>
            Save retention
          </Button>
        </div>
      </section>

      <section className="bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl p-5">
        <h2 className="text-[15px] font-semibold mb-1">HIPAA mode</h2>
        <p className="text-[12px] text-[var(--color-neutral-600)] mb-3">
          Toggles PHI-marked field protection, redacts logs, and unlocks BAA download.
        </p>
        <Button size="sm" variant="secondary" disabled={pending} onClick={toggleHipaa}>
          {hipaa ? "Disable HIPAA" : "Enable HIPAA"}
        </Button>
        <span className="ml-3 text-[12px] text-[var(--color-neutral-600)]">
          Currently: <b>{hipaa ? "ON" : "OFF"}</b>
        </span>
      </section>

      <section className="bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl p-5">
        <h2 className="text-[15px] font-semibold mb-1">BYOK — customer-managed key</h2>
        <p className="text-[12px] text-[var(--color-neutral-600)] mb-3">
          Super Admin only. Provide the KMS reference (e.g. AWS KMS ARN) that
          wraps this tenant&apos;s DEK.
        </p>
        <div className="grid grid-cols-[160px_1fr] gap-3 items-center">
          <label className="text-[12px]">Mode</label>
          <select
            className="px-2 py-1.5 rounded-md border border-[var(--color-neutral-300)] bg-[var(--color-surface)] text-[13px]"
            value={kmsMode}
            onChange={(e) => setKmsMode(e.target.value as "PLATFORM" | "BYOK")}
          >
            <option value="PLATFORM">PLATFORM (Solvr-managed)</option>
            <option value="BYOK">BYOK (customer KMS)</option>
          </select>
          {kmsMode === "BYOK" ? (
            <>
              <label className="text-[12px]">KMS key ref</label>
              <Input value={kmsKeyRef} onChange={(e) => setKmsKeyRef(e.target.value)} placeholder="arn:aws:kms:…" />
            </>
          ) : null}
        </div>
        <div className="mt-3">
          <Button size="sm" disabled={pending} onClick={saveByok}>
            Save BYOK
          </Button>
        </div>

        {shredded ? (
          <div className="mt-4 p-3 rounded-md bg-red-50 dark:bg-red-900/20 text-[12px] text-red-700 dark:text-red-300">
            Key was crypto-shredded at {new Date(status.shreddedAt!).toLocaleString()}. All PHI/encrypted values are unrecoverable.
          </div>
        ) : (
          <div className="mt-4 border-t border-[var(--color-neutral-200)] pt-3">
            <div className="text-[12px] font-semibold text-red-600 mb-1">Danger — crypto-shred</div>
            <p className="text-[11px] text-[var(--color-neutral-600)] mb-2">
              Type <code>SHRED-I-UNDERSTAND</code> and click to permanently destroy the tenant key. IRREVERSIBLE.
            </p>
            <div className="flex gap-2">
              <Input value={shredToken} onChange={(e) => setShredToken(e.target.value)} placeholder="SHRED-I-UNDERSTAND" />
              <Button size="sm" variant="secondary" disabled={pending || shredToken !== "SHRED-I-UNDERSTAND"} onClick={doShred}>
                Shred
              </Button>
            </div>
          </div>
        )}
      </section>

      {hipaa ? (
        <section className="bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl p-5">
          <h2 className="text-[15px] font-semibold mb-1">BAA</h2>
          <p className="text-[12px] text-[var(--color-neutral-600)] mb-3">
            Download a placeholder Business Associate Agreement. A countersigned version comes from Solvr Legal.
          </p>
          <a href="/api/compliance/baa" className="text-[12px] font-medium underline">
            Download BAA (text)
          </a>
        </section>
      ) : null}
    </div>
  );
}
