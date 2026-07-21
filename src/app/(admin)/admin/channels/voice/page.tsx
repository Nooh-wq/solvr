import { listChannelConfigs } from "@/actions/channels";
import { VoiceEditor } from "./voice-editor";

export const dynamic = "force-dynamic";

export default async function VoicePage() {
  const configs = await listChannelConfigs();
  const voiceConfigs = configs.filter((c) => c.channel === "VOICE");

  return (
    <div>
      <h1 className="text-2xl font-bold mb-1">Voice</h1>
      <p className="text-sm text-[var(--color-neutral-600)] mb-6 max-w-2xl">
        Connect a Twilio Voice number so inbound calls create tickets and outbound calls place
        through Solvr. Add your Twilio credentials below and point your Twilio number&apos;s
        Voice webhook at the URL we generate.
      </p>

      <div className="p-4 mb-6 rounded-2xl bg-[var(--color-warning)]/10 border border-[var(--color-warning)]/40 text-[13px] text-[var(--color-neutral-700)] max-w-3xl">
        <div className="font-semibold text-[var(--color-warning)] mb-1">Beta</div>
        Call config is live &mdash; credentials are envelope-encrypted and inbound signature
        verification runs on every webhook. Call-to-ticket conversion and the in-app softphone
        ship in a follow-up release; outbound send returns an explicit error until then.
      </div>

      <VoiceEditor initialConfigs={voiceConfigs} />
    </div>
  );
}
