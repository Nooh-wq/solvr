import { listApiKeys, getApiScopeCatalog, getAllowedScopesForCaller } from "@/actions/apiKeys";
import { ApiKeysForm } from "./api-keys-form";

export default async function ApiKeysPage() {
  const [keys, catalog, allowed] = await Promise.all([
    listApiKeys(),
    getApiScopeCatalog(),
    getAllowedScopesForCaller(),
  ]);
  return (
    <div>
      <h1 className="text-2xl font-bold mb-2">API keys</h1>
      <p className="text-[13px] text-[var(--color-neutral-600)] mb-6">
        Use these to authenticate against the public REST API (<code>/api/v1</code>).
      </p>
      <ApiKeysForm keys={keys} catalog={catalog} allowed={allowed} />
    </div>
  );
}
