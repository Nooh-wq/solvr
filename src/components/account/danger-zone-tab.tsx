"use client";

// M21.1 — Danger Zone tab is a placeholder. Data export (Inngest +
// signed URL), self-deactivate (immediate session revoke), and delete
// requests (into the admin approval queue with last-Super-Admin guard)
// ship in M21.6.

export function DangerZoneTab() {
  return (
    <div className="max-w-xl">
      <div className="bg-[var(--color-surface)] border border-dashed border-red-300/60 dark:border-red-500/30 rounded-2xl p-6 space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-[15px] font-semibold text-red-700 dark:text-red-400">Danger Zone</h2>
          <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-neutral-500)]">
            Coming soon
          </span>
        </div>
        <p className="text-[13px] text-[var(--color-neutral-600)]">
          Export your data, deactivate your account, and request account deletion. Ships in M21.6.
        </p>
      </div>
    </div>
  );
}
