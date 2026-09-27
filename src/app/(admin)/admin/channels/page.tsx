import { listChannelConfigs } from "@/actions/channels";
import { ChannelsManager } from "./channels-manager";

export default async function ChannelsPage() {
  const configs = await listChannelConfigs();
  return (
    <div>
      <h1 className="text-2xl font-bold mb-1">Channels</h1>
      <p className="text-sm text-[var(--color-neutral-600)] mb-6">
        Connect Stralis to SMS, WhatsApp, Messenger, and Instagram. Inbound messages become tickets;
        replies you send from the agent workspace route back through the provider.
      </p>
      <ChannelsManager configs={configs} />
    </div>
  );
}
