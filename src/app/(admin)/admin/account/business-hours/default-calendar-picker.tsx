"use client";

import { useState, useTransition } from "react";
import { updateDefaultBusinessCalendar } from "@/actions/accountSettings";

type Calendar = { id: string; name: string; timezone: string; isDefault: boolean };

export function DefaultCalendarPicker({
  initialSelected,
  calendars,
}: {
  initialSelected: string | null;
  calendars: Calendar[];
}) {
  const [selected, setSelected] = useState<string>(initialSelected ?? "");
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  function save() {
    setMessage(null);
    start(async () => {
      const res = await updateDefaultBusinessCalendar({
        defaultBusinessCalendarId: selected === "" ? null : selected,
      });
      setMessage(res.ok ? { kind: "ok", text: "Saved." } : { kind: "err", text: res.error });
    });
  }

  return (
    <div className="p-4 bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl flex flex-wrap items-end gap-3">
      <div className="flex-1 min-w-[260px]">
        <label className="text-[11px] uppercase-label text-[var(--color-neutral-600)]">
          Default calendar
        </label>
        <select
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          className="mt-1 w-full px-3 py-2 rounded-lg border border-[var(--color-neutral-300)] bg-transparent text-[13px]"
        >
          <option value="">— None (24×7) —</option>
          {calendars.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} ({c.timezone})
            </option>
          ))}
        </select>
      </div>
      {message ? (
        <span
          className={`text-[12px] ${
            message.kind === "ok" ? "text-[var(--color-success)]" : "text-[var(--color-danger)]"
          }`}
        >
          {message.text}
        </span>
      ) : null}
      <button
        type="button"
        onClick={save}
        disabled={pending}
        className="text-[12px] font-medium px-4 py-2 rounded-lg bg-[var(--color-primary)] text-[var(--color-on-primary)] disabled:opacity-50 cursor-pointer"
      >
        Save
      </button>
    </div>
  );
}
