import Link from "next/link";
import { MailIcon } from "@/components/icons";

// Replaces the pair of ClientProfileCard + OrganizationCard boxes that
// previously stacked in the right rail. Same content, one card, denser
// layout: client on top, org line underneath, ticket meta collapsed
// into a flat row of pill labels. Prior-activity + org-open-tickets
// numbers surface inline instead of in their own boxed row.

type ClientInfo = {
  name: string;
  email: string;
  avatarUrl: string | null;
  profileHref: string | null;
};

type OrgInfo = {
  id: string;
  name: string;
  openTicketCount: number;
};

type PriorActivity = {
  priorTicketCount: number;
  csatAvg: number | null;
  csatCount: number;
};

type TicketMeta = {
  createdAt: string;
  source: string;
  category: string | null;
};

function initials(name: string) {
  return name.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase();
}

export function ContactCard({
  client,
  organization,
  priorActivity,
  ticketMeta,
}: {
  client: ClientInfo;
  organization: OrgInfo | null;
  priorActivity: PriorActivity | null;
  ticketMeta: TicketMeta;
}) {
  return (
    <div className="bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl p-5">
      {/* Client identity */}
      <div className="flex items-start gap-3">
        {client.avatarUrl ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={client.avatarUrl}
            alt=""
            className="h-12 w-12 rounded-full object-cover shrink-0"
          />
        ) : (
          <span className="h-12 w-12 rounded-full bg-[var(--color-neutral-100)] text-[14px] font-semibold text-[var(--color-neutral-700)] flex items-center justify-center shrink-0">
            {initials(client.name)}
          </span>
        )}
        <div className="min-w-0 flex-1">
          {client.profileHref ? (
            <Link
              href={client.profileHref}
              className="text-[14px] font-semibold text-[var(--foreground)] hover:text-[var(--color-primary)] truncate block"
            >
              {client.name}
            </Link>
          ) : (
            <div className="text-[14px] font-semibold truncate">{client.name}</div>
          )}
          <a
            href={`mailto:${client.email}`}
            className="mt-0.5 inline-flex items-center gap-1.5 text-[12px] text-[var(--color-neutral-600)] hover:text-[var(--color-primary)] truncate"
          >
            <MailIcon className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{client.email}</span>
          </a>
        </div>
      </div>

      {/* Prior-activity line — only when the requester has history. */}
      {priorActivity && (priorActivity.priorTicketCount > 0 || priorActivity.csatCount > 0) && (
        <div className="mt-3 flex items-center gap-x-3 text-[12px] text-[var(--color-neutral-600)] flex-wrap">
          <span>
            <span className="font-medium text-[var(--foreground)]">
              {priorActivity.priorTicketCount}
            </span>{" "}
            prior
          </span>
          {priorActivity.csatAvg !== null && (
            <span>
              CSAT{" "}
              <span className="font-medium text-[var(--foreground)]">
                {priorActivity.csatAvg.toFixed(1)}
              </span>
            </span>
          )}
          {client.profileHref && (
            <Link
              href={client.profileHref}
              className="ml-auto text-[12px] text-[var(--color-primary)] hover:underline"
            >
              History →
            </Link>
          )}
        </div>
      )}

      {/* Organization inline block, when present. */}
      {organization && (
        <div className="mt-4 pt-3 border-t border-[var(--color-neutral-200)] dark:border-white/5 flex items-center gap-2.5">
          <div className="h-8 w-8 rounded-lg bg-[var(--color-primary)]/10 text-[var(--color-primary)] text-[11px] font-semibold flex items-center justify-center shrink-0">
            {organization.name.slice(0, 2).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <Link
              href={`/admin/organizations/${organization.id}`}
              className="text-[13px] font-medium hover:text-[var(--color-primary)] truncate block"
            >
              {organization.name}
            </Link>
            <div className="text-[11px] text-[var(--color-neutral-500)]">
              <span className="font-medium text-[var(--foreground)]">
                {organization.openTicketCount}
              </span>{" "}
              open on this org
            </div>
          </div>
        </div>
      )}

      {/* Ticket meta: compact key-value strip. */}
      <div className="mt-4 pt-3 border-t border-[var(--color-neutral-200)] dark:border-white/5 space-y-1.5 text-[12px]">
        <Row
          label="Opened"
          value={new Date(ticketMeta.createdAt).toLocaleDateString(undefined, {
            month: "short",
            day: "numeric",
            year: "numeric",
          })}
        />
        <Row label="Category" value={ticketMeta.category ?? "—"} />
        <Row label="Source" value={ticketMeta.source} />
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[var(--color-neutral-500)]">{label}</span>
      <span className="font-medium text-right truncate ml-2">{value}</span>
    </div>
  );
}
