import { getAiSettings } from "@/actions/aiSettings";
import { AiSettingsForm } from "./ai-settings-form";

export default async function AiSettingsPage() {
  const settings = await getAiSettings();
  return (
    <div>
      <h1 className="text-2xl font-bold mb-2">AI settings</h1>
      <p className="text-[13px] text-[var(--color-neutral-600)] mb-6">
        Control the intelligence layer at the tenant level.
      </p>
      <AiSettingsForm initial={settings} />
    </div>
  );
}
