"use client";

// Landing dashboard card — reads Z7.2's localStorage key so recently
// visited admin pages jump back into view. Client component because
// localStorage isn't available on the server.

import { useEffect, useState } from "react";
import Link from "next/link";

type Entry = { href: string; label: string };
const KEY = "solvr:admin-recently-viewed";

export function RecentlyViewedCard() {
  const [items, setItems] = useState<Entry[]>([]);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) setItems(JSON.parse(raw));
    } catch {
      /* corrupt entry — ignore */
    }
  }, []);
  return (
    <div className="bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl p-5">
      <h2 className="text-[13px] font-semibold mb-3">Recently viewed</h2>
      {items.length === 0 ? (
        <p className="text-[12px] text-[var(--color-neutral-500)]">
          Pages you visit will appear here so you can jump back quickly.
        </p>
      ) : (
        <ul className="space-y-1">
          {items.slice(0, 5).map((i) => (
            <li key={i.href}>
              <Link href={i.href} className="text-[13px] hover:underline">
                {i.label}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
