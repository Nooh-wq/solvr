"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";

/**
 * Light/Dark/System, defaulting to Dark (see the toggle in ProfileForm).
 * `attribute="class"` toggles `.dark` on <html> — see globals.css's
 * `@custom-variant dark` and the `.dark { ... }` variable overrides it
 * switches between. Persisted to localStorage by next-themes itself; the
 * inline script it injects reads that (falling back to the OS preference
 * for "system") before paint, so there's no flash of the wrong theme.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider attribute="class" defaultTheme="dark" enableSystem>
      {children}
    </NextThemesProvider>
  );
}
