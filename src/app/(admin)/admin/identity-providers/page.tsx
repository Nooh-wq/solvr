import { getIdentityProviders } from "@/actions/identityProviders";
import { IdentityProvidersForm } from "./identity-providers-form";
import { getCurrentTenant } from "@/lib/current-tenant";

export default async function IdentityProvidersPage() {
  const [providers, tenant] = await Promise.all([
    getIdentityProviders(),
    getCurrentTenant(),
  ]);
  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Identity providers</h1>
      <IdentityProvidersForm providers={providers} slug={tenant.slug} />
    </div>
  );
}
