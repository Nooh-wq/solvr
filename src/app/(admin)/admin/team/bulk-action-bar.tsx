"use client";

import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import { DownloadIcon } from "@/components/icons";

type AssignableRole = "CLIENT" | "AGENT" | "ADMIN";

export function BulkActionBar({
  count,
  onClear,
  onChangeRole,
  onDeactivate,
  onExport,
  disabled,
}: {
  count: number;
  onClear: () => void;
  onChangeRole: (role: AssignableRole) => void;
  onDeactivate: () => void;
  onExport: () => void;
  disabled?: boolean;
}) {
  if (count === 0) return null;

  return (
    <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-[var(--color-primary)]/30 bg-[var(--color-primary)]/[0.06] px-3 py-2">
      <span className="text-[13px] font-medium text-[var(--foreground)]">
        {count} selected
      </span>
      <button
        type="button"
        onClick={onClear}
        className="text-[12px] text-[var(--color-neutral-600)] hover:text-[var(--foreground)] underline underline-offset-2 cursor-pointer"
      >
        Clear
      </button>
      <div className="ml-auto flex items-center gap-2">
        <Select
          defaultValue=""
          disabled={disabled}
          onChange={(e) => {
            const val = e.target.value as AssignableRole | "";
            if (!val) return;
            onChangeRole(val);
            e.target.value = "";
          }}
          className="h-8 text-[13px] w-40"
        >
          <option value="" disabled>
            Change role…
          </option>
          <option value="CLIENT">Client</option>
          <option value="AGENT">Agent</option>
          <option value="ADMIN">Admin</option>
        </Select>
        <Button variant="secondary" size="sm" disabled={disabled} onClick={onDeactivate}>
          Deactivate
        </Button>
        <Button variant="secondary" size="sm" disabled={disabled} onClick={onExport} className="gap-1.5">
          <DownloadIcon className="h-4 w-4" />
          Export CSV
        </Button>
      </div>
    </div>
  );
}
