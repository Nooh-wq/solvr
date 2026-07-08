import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { getCurrentTenant } from "@/lib/current-tenant";
import { brandingToCssVars } from "@/lib/tenant";
import { ToastProvider } from "@/components/ui/toast";
import { ThemeProvider } from "@/components/theme-provider";
import { PreferenceSync } from "@/components/preference-sync";
import { getSessionUser } from "@/lib/auth";
import { withRls } from "@/lib/db";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export async function generateMetadata(): Promise<Metadata> {
  const tenant = await getCurrentTenant();
  const productName = tenant.branding?.productName ?? "solvr";
  return {
    title: `Support — ${productName}`,
    description: "Submit and track support requests.",
    icons: { icon: tenant.branding?.faviconUrl ?? "/brand/s-mark-black.svg" },
  };
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const tenant = await getCurrentTenant();
  // Runtime theming (TRD §2.2): a tenant's primaryColor/accentColor override
  // the Stralis defaults from globals.css via inline CSS vars on <html> — no
  // rebuild needed per tenant.
  const themeVars = brandingToCssVars(tenant.branding);

  // M21.5 — pull the acting session's server-persisted theme/density so
  // the client PreferenceSync can push them into next-themes + the
  // data-density attribute on load. Best-effort: sessionless pages
  // (login etc.) skip this and fall back to next-themes' own defaults.
  const user = await getSessionUser();
  const serverPref = user
    ? await withRls(
        { tenantId: user.tenantId, userId: user.subjectId, role: user.role },
        (tx) =>
          tx.subjectPreference.findUnique({
            where: { subjectId: user.subjectId },
            select: { theme: true, density: true },
          })
      )
    : null;

  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      style={themeVars as React.CSSProperties}
      data-density={serverPref?.density ?? undefined}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col">
        <ThemeProvider>
          <PreferenceSync
            serverTheme={serverPref?.theme ?? null}
            serverDensity={serverPref?.density ?? null}
          />
          <ToastProvider>{children}</ToastProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
