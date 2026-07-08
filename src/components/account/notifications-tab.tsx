"use client";

// M21.4 — Notifications tab. Per-event checkboxes for email + in-app,
// plus a digest-mode selector. Saves on any toggle change (no bulk
// "save" button — feels closer to iOS settings than a form). The gate
// itself lives in lib/notification-prefs.ts and is inserted at every
// notification send call site.

import { useEffect, useState, useTransition } from "react";
import {
  getMyNotificationPreferences,
  updateMyNotificationPreferences,
} from "@/actions/notificationPreferences";
import { useToast } from "@/components/ui/toast";

type Prefs = {
  emailTicketCreated: boolean;
  emailTicketReply: boolean;
  emailStatusChange: boolean;
  emailAssigned: boolean;
  emailCsatRequest: boolean;
  inAppTicketReply: boolean;
  inAppStatusChange: boolean;
  inAppAssigned: boolean;
  digestMode: string;
};

const EMAIL_ROWS: Array<{ key: keyof Prefs; label: string; description: string }> = [
  { key: "emailTicketCreated", label: "Ticket created", description: "Confirmation when a new ticket you filed is received." },
  { key: "emailTicketReply", label: "New reply", description: "A client or agent has replied to a ticket you're on." },
  { key: "emailStatusChange", label: "Status change", description: "A ticket you're on moves to a new status." },
  { key: "emailAssigned", label: "Assigned to me", description: "An agent — you — has just been assigned to a ticket." },
  { key: "emailCsatRequest", label: "Rate your experience", description: "A one-time survey link after a ticket is resolved. Never digested." },
];

const IN_APP_ROWS: Array<{ key: keyof Prefs; label: string; description: string }> = [
  { key: "inAppTicketReply", label: "New reply", description: "Bell notification when a ticket you're on gets a reply." },
  { key: "inAppStatusChange", label: "Status change", description: "Bell notification when a ticket you're on changes status." },
  { key: "inAppAssigned", label: "Assigned to me", description: "Bell notification when an agent — you — is newly assigned." },
];

export function NotificationsTab() {
  const { toast } = useToast();
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [pending, startTransition] = useTransition();

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    (async () => {
      const p = await getMyNotificationPreferences();
      setPrefs(p);
    })();
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  function apply(patch: Partial<Prefs>) {
    if (!prefs) return;
    const next = { ...prefs, ...patch };
    setPrefs(next);
    startTransition(async () => {
      const result = await updateMyNotificationPreferences(patch);
      if ("error" in result) {
        toast({ title: "Couldn't save", description: result.error, variant: "error" });
        // Roll back optimistic update.
        setPrefs(prefs);
      }
    });
  }

  if (!prefs) {
    return (
      <div className="max-w-xl">
        <div className="bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl p-6 text-[13px] text-[var(--color-neutral-500)]">
          Loading…
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-xl">
      <div className="bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl p-6 space-y-4">
        <h2 className="text-[15px] font-semibold">Delivery</h2>
        <p className="text-[13px] text-[var(--color-neutral-600)]">
          Real-time emails fire the moment an event happens. In daily mode, they're batched into
          one summary sent overnight.
        </p>
        <div className="flex gap-2">
          {[
            { value: "INSTANT", label: "Real-time" },
            { value: "DAILY", label: "Daily digest" },
          ].map((opt) => {
            const active = prefs.digestMode === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                disabled={pending}
                onClick={() => apply({ digestMode: opt.value })}
                className={`flex-1 h-9 rounded-xl text-[13px] font-medium border transition-colors duration-150 cursor-pointer ${
                  active
                    ? "bg-[var(--color-primary)] text-white border-[var(--color-primary)]"
                    : "bg-transparent border-[var(--color-neutral-300)] text-[var(--color-neutral-700)] hover:bg-[var(--color-light-gray)]"
                }`}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      </div>

      <PrefSection title="Email" rows={EMAIL_ROWS} prefs={prefs} onChange={apply} pending={pending} />
      <PrefSection title="In-app" rows={IN_APP_ROWS} prefs={prefs} onChange={apply} pending={pending} />
    </div>
  );
}

function PrefSection({
  title,
  rows,
  prefs,
  onChange,
  pending,
}: {
  title: string;
  rows: Array<{ key: keyof Prefs; label: string; description: string }>;
  prefs: Prefs;
  onChange: (patch: Partial<Prefs>) => void;
  pending: boolean;
}) {
  return (
    <div className="bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl p-6 space-y-3">
      <h2 className="text-[15px] font-semibold">{title}</h2>
      <ul className="divide-y divide-[var(--color-neutral-200)] dark:divide-white/10 -mx-2">
        {rows.map((r) => {
          const on = prefs[r.key] as boolean;
          return (
            <li key={r.key as string} className="px-2 py-3 flex items-start gap-4">
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-medium">{r.label}</div>
                <div className="text-[11px] text-[var(--color-neutral-500)] mt-0.5">{r.description}</div>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={on}
                aria-label={r.label}
                disabled={pending}
                onClick={() => onChange({ [r.key]: !on } as Partial<Prefs>)}
                className={`shrink-0 h-6 w-11 rounded-full transition-colors duration-150 cursor-pointer relative ${
                  on ? "bg-[var(--color-primary)]" : "bg-[var(--color-neutral-300)]"
                }`}
              >
                {/* left/right positioning (not translate) so the circle always
                    sits an even 2px from either edge regardless of container
                    width — the earlier translate math bunched the knob against
                    the right edge on ON. */}
                <span
                  className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-all duration-150 ${
                    on ? "left-auto right-0.5" : "left-0.5 right-auto"
                  }`}
                />
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
