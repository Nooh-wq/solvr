import { listAssets } from "@/actions/assets";
import { AssetsManager } from "./assets-manager";

export default async function AssetsPage() {
  const assets = await listAssets();
  return (
    <div>
      <h1 className="text-2xl font-bold mb-1">Assets</h1>
      <p className="text-sm text-[var(--color-neutral-600)] mb-6">
        Laptops, licenses, access. Assets can be linked to tickets from ticket detail. Creation is explicit —
        nothing here auto-generates rows from ticket bodies.
      </p>
      <AssetsManager assets={assets} />
    </div>
  );
}
