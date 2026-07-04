import { MailIcon } from "@/components/icons";

type ClientInfo = {
  name: string;
  email: string;
  company: string | null;
  avatarUrl: string | null;
};

function initials(name: string) {
  return name
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

/** Right-rail "who am I talking to" card, mirroring the reference layout. */
export function ClientProfileCard({
  client,
  ticketMeta,
}: {
  client: ClientInfo;
  ticketMeta: { createdAt: string; source: string; category: string | null };
}) {
  return (
    <div className="bg-white border border-[var(--color-neutral-300)] rounded-2xl p-5 mt-6">
      <p className="uppercase-label text-[11px] text-[var(--color-neutral-600)] mb-3">Client</p>
      <div className="flex flex-col items-center text-center">
        {client.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={client.avatarUrl} alt="" className="h-16 w-16 rounded-full object-cover" />
        ) : (
          <span className="h-16 w-16 rounded-full bg-[var(--color-neutral-100)] text-[18px] font-semibold text-[var(--color-neutral-700)] flex items-center justify-center">
            {initials(client.name)}
          </span>
        )}
        <p className="mt-2 text-[15px] font-semibold">{client.name}</p>
        {client.company && <p className="text-[12px] text-[var(--color-neutral-600)]">{client.company}</p>}
        <a
          href={`mailto:${client.email}`}
          className="mt-1 inline-flex items-center gap-1.5 text-[12px] text-[var(--color-primary)] hover:underline"
        >
          <MailIcon className="h-3.5 w-3.5" />
          {client.email}
        </a>
      </div>

      <div className="mt-4 pt-4 border-t border-black/5 space-y-2 text-[12px]">
        <Row label="Opened" value={new Date(ticketMeta.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })} />
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
      <span className="font-medium text-right">{value}</span>
    </div>
  );
}
