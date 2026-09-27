import { getComplianceStatus } from "@/actions/compliance";
import { ComplianceEditor } from "./compliance-editor";

export default async function CompliancePage() {
  const status = await getComplianceStatus();
  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-bold mb-1">Compliance</h1>
      <p className="text-sm text-[var(--color-neutral-600)] mb-6">
        Data residency, retention TTL, PHI protection, and BYOK. Contact your
        account team to change residency after provisioning.
      </p>
      <ComplianceEditor status={status} />
    </div>
  );
}
