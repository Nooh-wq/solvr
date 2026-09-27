import { listHelpCenters } from "@/actions/helpCenters";
import { HelpCentersManager } from "./help-centers-manager";

export default async function HelpCentersPage() {
  const centers = await listHelpCenters();
  return (
    <div>
      <h1 className="text-2xl font-bold mb-1">Help centers</h1>
      <p className="text-sm text-[var(--color-neutral-600)] mb-6">
        Run one or more branded help centers per tenant. Each has its own KB, community forum (optional), and can be
        served on a custom domain. Domain resolution fails closed — an unrecognized host cannot serve any tenant&apos;s
        articles.
      </p>
      <HelpCentersManager centers={centers} />
    </div>
  );
}
