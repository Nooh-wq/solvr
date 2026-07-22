import Link from "next/link";
import { getPortalSettings } from "@/actions/workspaceSettings";
import { PortalModeToggle } from "./portal-mode-toggle";

export const dynamic = "force-dynamic";

export default async function PortalAdminPage() {
  const settings = await getPortalSettings();
  const portalUrl = settings.customDomain
    ? `https://${settings.customDomain}`
    : `${process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"}/portal`;

  return (
    <div>
      <h1 className="text-2xl font-bold mb-1">Portal</h1>
      <p className="text-sm text-[var(--color-neutral-600)] mb-6 max-w-2xl">
        The customer-facing portal at{" "}
        <a href={portalUrl} className="underline" target="_blank" rel="noopener noreferrer">
          {portalUrl.replace(/^https?:\/\//, "")}
        </a>{" "}
        &mdash; where end users file and follow up on tickets.
      </p>

      <div className="grid gap-4 md:grid-cols-2 max-w-4xl">
        <section className="p-5 bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl">
          <h2 className="text-[15px] font-semibold mb-3">Service mode</h2>
          <p className="text-[13px] text-[var(--color-neutral-600)] mb-4">
            <strong>Customer</strong> mode is the default. <strong>Employee</strong> mode swaps
            terminology (ticket &rarr; request, customer &rarr; employee, category &rarr; service
            catalog) and re-orders the portal home to lead with the Service Catalog. Reversible
            &mdash; no data migration.
          </p>
          <PortalModeToggle initialMode={settings.serviceMode as "CUSTOMER" | "EMPLOYEE"} />
        </section>

        <section className="p-5 bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl">
          <h2 className="text-[15px] font-semibold mb-3">Branding</h2>
          <p className="text-[13px] text-[var(--color-neutral-600)] mb-4">
            Logo, colors, and typography that render on the portal, help center, and outbound
            emails. Managed centrally at{" "}
            <Link href="/admin/branding" className="underline">
              Branding
            </Link>
            .
          </p>
          {settings.brandingLogoUrl ? (
            <div className="p-3 rounded-lg bg-[var(--color-neutral-100)]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={settings.brandingLogoUrl}
                alt="Current logo"
                className="max-h-12 mx-auto"
              />
            </div>
          ) : (
            <div className="p-3 rounded-lg bg-[var(--color-neutral-100)] text-[12px] text-[var(--color-neutral-500)] text-center">
              No logo uploaded yet.
            </div>
          )}
          <Link
            href="/admin/branding"
            className="mt-3 inline-block text-[12px] font-medium px-4 py-2 rounded-lg bg-[var(--color-primary)] text-[var(--color-on-primary)] hover:opacity-90"
          >
            Open branding
          </Link>
        </section>

        <section className="p-5 bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl">
          <h2 className="text-[15px] font-semibold mb-3">Ticket forms</h2>
          <p className="text-[13px] text-[var(--color-neutral-600)] mb-4">
            What customers see when they file a ticket &mdash; fields, required-ness, and category
            routing. Manage under{" "}
            <Link href="/admin/forms" className="underline">
              Ticket forms
            </Link>
            .
          </p>
        </section>

        <section className="p-5 bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl">
          <h2 className="text-[15px] font-semibold mb-3">Help center + community</h2>
          <p className="text-[13px] text-[var(--color-neutral-600)] mb-4">
            The KB / help center and community forum surfaces linked from the portal. Manage
            under{" "}
            <Link href="/admin/kb" className="underline">
              Knowledge base
            </Link>
            .
          </p>
        </section>

        <section className="p-5 bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl">
          <h2 className="text-[15px] font-semibold mb-3">Custom domain</h2>
          <p className="text-[13px] text-[var(--color-neutral-600)] mb-4">
            {settings.customDomain ? (
              <>
                Portal currently serves from <code>{settings.customDomain}</code>.
              </>
            ) : (
              <>Portal currently serves from the default hostname.</>
            )}{" "}
            Change under{" "}
            <Link href="/admin/account/domains" className="underline">
              Custom domains
            </Link>
            .
          </p>
        </section>
      </div>
    </div>
  );
}
