import { getMyProfile } from "@/actions/profile";
import { getMyPreferences } from "@/actions/preferences";
import { AccountSettingsShell } from "@/components/account/shell";

export default async function AccountPage() {
  const [profile, preferences] = await Promise.all([getMyProfile(), getMyPreferences()]);
  return <AccountSettingsShell profile={profile} preferences={preferences} />;
}
