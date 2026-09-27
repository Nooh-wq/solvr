// src/components/channel-badge.tsx
//
// M12.5 — the badge that surfaces the ticket's origin channel in the
// queue + on ticket detail. Pure presentational; source strings map to
// human labels + a colour cue via the same table used by the
// connector registry.

const LABEL: Record<string, { label: string; icon: string; tint: string }> = {
  sms: { label: "SMS", icon: "💬", tint: "bg-blue-100 text-blue-800" },
  whatsapp: { label: "WhatsApp", icon: "🟢", tint: "bg-green-100 text-green-800" },
  messenger: { label: "Messenger", icon: "💬", tint: "bg-indigo-100 text-indigo-800" },
  instagram: { label: "Instagram", icon: "📷", tint: "bg-pink-100 text-pink-800" },
  portal: { label: "Portal", icon: "🌐", tint: "bg-neutral-100 text-neutral-700" },
  chatbot: { label: "Chatbot", icon: "🤖", tint: "bg-neutral-100 text-neutral-700" },
  email: { label: "Email", icon: "✉️", tint: "bg-neutral-100 text-neutral-700" },
  service_catalog: { label: "Catalog", icon: "🧾", tint: "bg-amber-100 text-amber-800" },
};

export function ChannelBadge({ source }: { source: string | null | undefined }) {
  if (!source) return null;
  const meta = LABEL[source.toLowerCase()] ?? {
    label: source,
    icon: "•",
    tint: "bg-neutral-100 text-neutral-700",
  };
  return (
    <span
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium ${meta.tint}`}
      title={`Source: ${meta.label}`}
    >
      <span aria-hidden>{meta.icon}</span>
      {meta.label}
    </span>
  );
}
