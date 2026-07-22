import { getAccountSettings } from "@/actions/accountSettings";
import { LocalizationEditor } from "./localization-editor";

export const dynamic = "force-dynamic";

export default async function LocalizationPage() {
  const settings = await getAccountSettings();
  return (
    <div>
      <h1 className="text-2xl font-bold mb-1">Localization</h1>
      <p className="text-sm text-[var(--color-neutral-600)] mb-6 max-w-2xl">
        Default language and timezone for outbound emails, timestamps in the agent UI, and the
        customer portal. Individual users can override this from their account preferences.
      </p>
      <LocalizationEditor initialLocale={settings.locale} initialTimezone={settings.timezone} />
    </div>
  );
}
