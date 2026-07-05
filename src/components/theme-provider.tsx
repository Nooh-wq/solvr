"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";

/**
 * Light/Dark/System, defaulting to System — a first-time visitor gets
 * whatever their OS is set to, not a hardcoded theme (see the toggle in
 * ProfileForm for overriding it explicitly). `attribute="class"` toggles
 * `.dark` on <html> — see globals.css's `@custom-variant dark` and the
 * `.dark { ... }` variable overrides it switches between. Persisted to
 * localStorage by next-themes itself; the inline script it injects reads
 * that (falling back to the OS preference for "system") before paint, so
 * there's no flash of the wrong theme.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider attribute="class" defaultTheme="system" enableSystem>
      {children}
    </NextThemesProvider>
  );
}
