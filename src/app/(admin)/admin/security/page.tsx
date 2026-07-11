import { getTenantSecuritySettings } from "@/actions/tenantSecurity";
import { SecuritySettingsForm } from "./security-form";

// M6.1.b — tenant security settings. Currently one control: enforce 2FA
// tenant-wide. SSO / IdP mapping / SCIM configuration land alongside
// this in M6.2-M6.7.
export default async function AdminSecurityPage() {
  const settings = await getTenantSecuritySettings();
  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Security</h1>
      <SecuritySettingsForm initial={settings} />
    </div>
  );
}
