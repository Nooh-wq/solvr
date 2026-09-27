// src/components/channel-composer-hint.tsx
//
// M12.5 — composer warning banner. WhatsApp Business is the load-
// bearing case: outside the 24-hour session window, free-form
// messages are blocked by Meta — a pre-approved template is required.
// The composer surfaces the warning BEFORE the agent sends, not as a
// rejection after the fact.

import { lookupConnector } from "@/lib/channels/registry";
import { channelForTicketSource } from "@/lib/channels/dispatch";

export function ChannelComposerHint({
  ticketSource,
  hoursSinceLastInbound,
}: {
  ticketSource: string | null | undefined;
  hoursSinceLastInbound: number | null;
}) {
  if (!ticketSource) return null;
  const channel = channelForTicketSource(ticketSource);
  if (!channel) return null;
  const connector = lookupConnector(channel);
  if (!connector?.requiresTemplateWarning) return null;
  const warning = connector.requiresTemplateWarning({ hoursSinceLastInbound });
  if (!warning) return null;
  return (
    <div className="mb-3 rounded-md bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 p-3 text-[12px] text-amber-800 dark:text-amber-200">
      <div className="font-semibold mb-0.5">⚠️ WhatsApp policy</div>
      {warning}
    </div>
  );
}
