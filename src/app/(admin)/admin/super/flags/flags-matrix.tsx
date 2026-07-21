"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { setFeatureFlag, type FeatureFlagRow } from "@/actions/superAdmin";
import type { FeatureFlagDef } from "@/lib/feature-flags";

const CATEGORY_ORDER: Record<FeatureFlagDef["category"], number> = {
  beta: 0,
  experimental: 1,
  internal: 2,
  legacy: 3,
};

const CATEGORY_BADGE: Record<FeatureFlagDef["category"], string> = {
  beta: "bg-[var(--color-primary)]/10 text-[var(--color-primary)]",
  experimental: "bg-[var(--color-warning)]/15 text-[var(--color-warning)]",
  internal: "bg-[var(--color-neutral-200)] text-[var(--color-neutral-700)]",
  legacy: "bg-[var(--color-danger)]/10 text-[var(--color-danger)]",
};

export function FlagsMatrix({ flags, rows }: { flags: FeatureFlagDef[]; rows: FeatureFlagRow[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [expandedFlag, setExpandedFlag] = useState<string | null>(flags[0]?.key ?? null);

  const sortedFlags = [...flags].sort(
    (a, b) => CATEGORY_ORDER[a.category] - CATEGORY_ORDER[b.category] || a.label.localeCompare(b.label)
  );
  const filteredRows = filter
    ? rows.filter(
        (r) =>
          r.tenantName.toLowerCase().includes(filter.toLowerCase()) ||
          r.slug.toLowerCase().includes(filter.toLowerCase())
      )
    : rows;

  function toggle(tenantId: string, key: string, next: boolean) {
    setError(null);
    start(async () => {
      const res = await setFeatureFlag({ tenantId, key, enabled: next });
      if (!res.ok) setError(res.error);
      else router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      {error ? (
        <div className="p-3 rounded-lg bg-[var(--color-danger)]/10 text-[var(--color-danger)] text-[13px]">
          {error}
        </div>
      ) : null}

      <input
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder="Filter tenants…"
        className="w-64 px-3 py-2 rounded-lg border border-[var(--color-neutral-300)] bg-transparent text-[13px]"
      />

      <div className="space-y-3">
        {sortedFlags.map((f) => {
          const isOpen = expandedFlag === f.key;
          const enabledCount = filteredRows.filter((r) => r.flags[f.key] === true).length;
          return (
            <div
              key={f.key}
              className="bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl overflow-hidden"
            >
              <button
                type="button"
                onClick={() => setExpandedFlag(isOpen ? null : f.key)}
                className="w-full text-left px-4 py-3 flex items-center justify-between hover:bg-[var(--color-neutral-100)] cursor-pointer"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold">{f.label}</span>
                    <span
                      className={`text-[10px] uppercase-label px-2 py-0.5 rounded-full ${CATEGORY_BADGE[f.category]}`}
                    >
                      {f.category}
                    </span>
                  </div>
                  <div className="text-[12px] text-[var(--color-neutral-600)]">{f.description}</div>
                </div>
                <div className="text-[12px] text-[var(--color-neutral-600)] font-mono ml-4">
                  {enabledCount} / {filteredRows.length} on
                </div>
              </button>
              {isOpen ? (
                <div className="border-t border-[var(--color-neutral-200)] max-h-80 overflow-y-auto">
                  {filteredRows.length === 0 ? (
                    <div className="p-4 text-[13px] text-[var(--color-neutral-600)] text-center">
                      No matching tenants.
                    </div>
                  ) : (
                    filteredRows.map((r) => {
                      const on = r.flags[f.key] === true;
                      return (
                        <div
                          key={r.tenantId}
                          className="flex items-center justify-between px-4 py-2 border-b border-[var(--color-neutral-100)] last:border-b-0"
                        >
                          <div>
                            <div className="text-[13px] font-medium">{r.tenantName}</div>
                            <div className="text-[11px] text-[var(--color-neutral-500)] font-mono">
                              {r.slug} · {r.type}
                            </div>
                          </div>
                          <button
                            type="button"
                            disabled={pending}
                            onClick={() => toggle(r.tenantId, f.key, !on)}
                            className={`text-[12px] font-medium px-3 py-1 rounded-full cursor-pointer disabled:opacity-50 ${
                              on
                                ? "bg-[var(--color-success)]/15 text-[var(--color-success)]"
                                : "bg-[var(--color-neutral-100)] text-[var(--color-neutral-600)]"
                            }`}
                          >
                            {on ? "On" : "Off"}
                          </button>
                        </div>
                      );
                    })
                  )}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
