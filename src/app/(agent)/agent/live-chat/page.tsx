import { listAgentLiveChats } from "@/actions/liveChat";
import { getMyPresence } from "@/actions/agentPresence";
import { LiveChatConsole } from "./live-chat-console";

export default async function LiveChatPage() {
  const [conversations, presence] = await Promise.all([
    listAgentLiveChats(),
    getMyPresence(),
  ]);
  return (
    <div className="p-6">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold mb-1">Live chat</h1>
          <p className="text-sm text-[var(--color-neutral-600)]">
            Waiting conversations show at the top. Pick one up to start chatting; convert to a ticket when done.
          </p>
        </div>
      </div>
      <LiveChatConsole conversations={conversations} presence={presence.status} />
    </div>
  );
}
