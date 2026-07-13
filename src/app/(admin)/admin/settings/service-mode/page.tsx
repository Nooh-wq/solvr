import { getTenantServiceMode } from "@/actions/serviceMode";
import { ServiceModeToggle } from "./service-mode-toggle";

export default async function ServiceModePage() {
  const mode = await getTenantServiceMode();
  return (
    <div>
      <h1 className="text-2xl font-bold mb-1">Service mode</h1>
      <p className="text-sm text-[var(--color-neutral-600)] mb-6">
        Customer mode is the classic support experience — tickets, customers, categories. Employee mode swaps
        terminology and leads the portal with the Service Catalog for internal IT / HR requests. The toggle is
        reversible — only labels and default navigation change; existing tickets stay put.
      </p>
      <ServiceModeToggle initial={mode} />
    </div>
  );
}
