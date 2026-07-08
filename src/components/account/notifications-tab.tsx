"use client";

// M21.1 — Notifications tab is a placeholder. The preference matrix,
// digest mode, and the shouldNotify() gate at every send call site ship
// in M21.4.

export function NotificationsTab() {
  return (
    <div className="max-w-xl">
      <div className="bg-[var(--color-surface)] border border-dashed border-[var(--color-neutral-300)] rounded-2xl p-8 text-center space-y-2">
        <h2 className="text-[15px] font-semibold">Notifications</h2>
        <p className="text-[13px] text-[var(--color-neutral-600)]">
          Per-event email preferences and digest mode ship in M21.4. Until then, every event you're
          entitled to still emails you.
        </p>
      </div>
    </div>
  );
}
