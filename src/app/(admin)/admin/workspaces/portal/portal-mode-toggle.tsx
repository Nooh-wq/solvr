"use client";

import { useState, useTransition } from "react";
import { updatePortalMode } from "@/actions/workspaceSettings";

export function PortalModeToggle({ initialMode }: { initialMode: "CUSTOMER" | "EMPLOYEE" }) {
  const [mode, setMode] = useState(initialMode);
  const [message, setMessage] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [pending, start] = useTransition();

  function set(next: "CUSTOMER" | "EMPLOYEE") {
    if (next === mode) return;
    setMessage(null);
    start(async () => {
      const res = await updatePortalMode({ serviceMode: next });
      if (res.ok) {
        setMode(next);
        setMessage({ kind: "ok", text: "Saved." });
      } else {
        setMessage({ kind: "err", text: res.error });
      }
    });
  }

  return (
    <div>
      <div className="inline-flex rounded-lg border border-[var(--color-neutral-300)] overflow-hidden">
        <button
          type="button"
          disabled={pending}
          onClick={() => set("CUSTOMER")}
          className={`text-[12px] font-medium px-4 py-2 cursor-pointer disabled:opacity-50 ${
            mode === "CUSTOMER"
              ? "bg-[var(--color-primary)] text-[var(--color-on-primary)]"
              : "bg-transparent hover:bg-[var(--color-neutral-100)]"
          }`}
        >
          Customer support
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => set("EMPLOYEE")}
          className={`text-[12px] font-medium px-4 py-2 cursor-pointer disabled:opacity-50 border-l border-[var(--color-neutral-300)] ${
            mode === "EMPLOYEE"
              ? "bg-[var(--color-primary)] text-[var(--color-on-primary)]"
              : "bg-transparent hover:bg-[var(--color-neutral-100)]"
          }`}
        >
          Internal / Employee
        </button>
      </div>
      {message ? (
        <div
          className={`mt-2 text-[12px] ${
            message.kind === "ok" ? "text-[var(--color-success)]" : "text-[var(--color-danger)]"
          }`}
        >
          {message.text}
        </div>
      ) : null}
    </div>
  );
}
