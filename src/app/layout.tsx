import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { getCurrentTenant } from "@/lib/current-tenant";
import { brandingToCssVars } from "@/lib/tenant";

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

  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      style={themeVars as React.CSSProperties}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
