"use client";

// Phase 4g — Admin center mobile hint. Some editors (rule builder,
// prompt library, ticket layout) are cramped on a phone. Show a
// dismissible banner on viewports narrower than 768px so admins on the
// go know the desktop experience is meaningfully better, without
// blocking them.

import { useEffect, useState } from "react";

const DISMISS_KEY = "solvr:mobile-desktop-banner:dismissed";

export function MobileDesktopBanner() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mql = window.matchMedia("(max-width: 767px)");
    function update() {
      const isMobile = mql.matches;
      const dismissed = localStorage.getItem(DISMISS_KEY) === "1";
      setVisible(isMobile && !dismissed);
    }
    update();
    mql.addEventListener?.("change", update);
    return () => mql.removeEventListener?.("change", update);
  }, []);

  function dismiss() {
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      /* ignore */
    }
    setVisible(false);
  }

  if (!visible) return null;
  return (
    <div className="fixed bottom-3 left-3 right-3 z-40 rounded-2xl bg-[var(--color-neutral-900)] text-[var(--color-neutral-100)] shadow-xl px-4 py-3 flex items-center justify-between gap-3">
      <div className="text-[12px]">
        <div className="font-semibold">Admin Center is easier on desktop</div>
        <div className="opacity-75">Complex editors need more room than a phone screen has.</div>
      </div>
      <button
        type="button"
        onClick={dismiss}
        className="text-[11px] uppercase-label px-3 py-1 rounded-full bg-[var(--color-neutral-100)]/10 hover:bg-[var(--color-neutral-100)]/20 cursor-pointer whitespace-nowrap"
      >
        Got it
      </button>
    </div>
  );
}
