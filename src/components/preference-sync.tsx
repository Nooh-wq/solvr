"use client";

// M21.5 — client-side syncer for server-persisted appearance preferences.
//
// The root layout reads SubjectPreference server-side and hands the
// theme/density values here. On mount:
//   * theme is pushed into next-themes so that a device with empty
//     localStorage (a new browser, incognito) immediately matches what
//     the user last chose elsewhere;
//   * density is applied as a `data-density` attribute on <html>, which
//     globals.css uses to swap a small handful of spacing CSS variables.
//
// This is a "sync on load" pattern (not "force on every render") — the
// Appearance tab still owns the interactive toggles, and setTheme() there
// updates both localStorage and this same DB row.

import { useEffect } from "react";
import { useTheme } from "next-themes";

export function PreferenceSync({
  serverTheme,
  serverDensity,
}: {
  serverTheme: string | null;
  serverDensity: string | null;
}) {
  const { theme, setTheme } = useTheme();

  useEffect(() => {
    if (serverTheme && serverTheme !== theme) setTheme(serverTheme);
  }, [serverTheme, theme, setTheme]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    if (serverDensity) document.documentElement.setAttribute("data-density", serverDensity);
    else document.documentElement.removeAttribute("data-density");
  }, [serverDensity]);

  return null;
}
