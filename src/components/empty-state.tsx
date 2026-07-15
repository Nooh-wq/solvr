// M-admin — shared EmptyState. Spec §Empty states: "Every list page has
// a designed empty state, not a blank table with a header." Renders a
// small illustration slot + heading + description + primary CTA + link.

import Link from "next/link";
import type { ReactNode } from "react";

export type EmptyStateProps = {
  title: string;
  description: string;
  primaryCta?: { label: string; href: string };
  secondaryCta?: { label: string; href: string };
  icon?: ReactNode;
};

export function EmptyState({ title, description, primaryCta, secondaryCta, icon }: EmptyStateProps) {
  return (
    <div className="bg-[var(--color-surface)] border border-dashed border-[var(--color-neutral-300)] rounded-2xl p-10 text-center">
      <div className="mx-auto mb-4 h-12 w-12 rounded-full bg-[var(--color-neutral-100)] flex items-center justify-center text-[24px]">
        {icon ?? <span aria-hidden>✨</span>}
      </div>
      <h2 className="text-[15px] font-semibold mb-1">{title}</h2>
      <p className="text-[13px] text-[var(--color-neutral-600)] max-w-md mx-auto mb-4">{description}</p>
      <div className="flex justify-center gap-3">
        {primaryCta ? (
          <Link
            href={primaryCta.href}
            className="text-[12px] font-medium px-4 py-2 rounded-lg bg-[var(--color-primary)] text-[var(--color-on-primary)] hover:opacity-90"
          >
            {primaryCta.label}
          </Link>
        ) : null}
        {secondaryCta ? (
          <Link
            href={secondaryCta.href}
            className="text-[12px] font-medium px-4 py-2 rounded-lg border border-[var(--color-neutral-300)] hover:bg-[var(--color-neutral-100)]"
          >
            {secondaryCta.label}
          </Link>
        ) : null}
      </div>
    </div>
  );
}

/**
 * ComingSoon — for Admin Center sub-pages the spec lists but that this
 * milestone deliberately doesn't build (spec §"Do not rebuild features"
 * + §"consolidation only"). Renders a clean "planned, not built yet"
 * card so admins know the surface is real, just deferred.
 */
export function ComingSoon({
  title,
  description,
  href,
}: {
  title: string;
  description: string;
  href?: string;
}) {
  return (
    <div>
      <h1 className="text-2xl font-bold mb-1">{title}</h1>
      <p className="text-sm text-[var(--color-neutral-600)] mb-6">{description}</p>
      <EmptyState
        title="Coming in a later milestone"
        description="This surface is planned in the Admin Center spec but not built in this consolidation pass. Track progress via the milestone tracker."
        primaryCta={href ? { label: "Back to Admin Center", href: "/admin" } : undefined}
      />
    </div>
  );
}
