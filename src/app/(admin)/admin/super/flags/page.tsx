import { listTenantsWithFlags } from "@/actions/superAdmin";
import { FEATURE_FLAGS } from "@/lib/feature-flags";
import { FlagsMatrix } from "./flags-matrix";

export const dynamic = "force-dynamic";

export default async function FeatureFlagsPage() {
  const rows = await listTenantsWithFlags();

  return (
    <div>
      <h1 className="text-2xl font-bold mb-1">Feature flags</h1>
      <p className="text-sm text-[var(--color-neutral-600)] mb-6 max-w-2xl">
        Turn features on or off per tenant. Changes take effect immediately. Legacy and internal
        flags are ordered last.
      </p>
      <FlagsMatrix flags={FEATURE_FLAGS} rows={rows} />
    </div>
  );
}
