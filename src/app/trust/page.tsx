// M20.7 — Trust Center. Read-only summary of compliance posture for
// the current tenant. Public within the tenant (any signed-in role),
// no secrets — just flags + BAA link + SOC 2 attestation.

import { getComplianceStatus } from "@/actions/compliance";

export default async function TrustCenterPage() {
  const s = await getComplianceStatus();
  return (
    <div className="max-w-2xl mx-auto px-6 py-12">
      <h1 className="text-3xl font-bold mb-2">Trust Center</h1>
      <p className="text-sm text-[var(--color-neutral-600)] mb-8">
        Compliance posture for this workspace.
      </p>

      <div className="space-y-4">
        <Row label="Data residency" value={s.residencyRegion} />
        <Row label="HIPAA mode" value={s.hipaaEnabled ? "Enabled" : "Not enabled"} />
        <Row
          label="Encryption at rest"
          value={
            s.kmsMode === "BYOK"
              ? `Customer-managed KMS (${s.kmsKeyRef ?? "unconfigured"})`
              : "Solvr-managed per-tenant DEK"
          }
        />
        {s.shreddedAt ? (
          <Row label="Key status" value={`SHREDDED at ${new Date(s.shreddedAt).toLocaleString()}`} />
        ) : null}
        <Row
          label="SOC 2 Type II"
          value="Available on request via your account team."
        />
        {s.hipaaEnabled ? (
          <Row
            label="BAA"
            value={
              <a href="/api/compliance/baa" className="underline">
                Download BAA (placeholder)
              </a>
            }
          />
        ) : null}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl p-4 flex items-start justify-between gap-4">
      <div className="text-[12px] uppercase-label text-[var(--color-neutral-600)]">{label}</div>
      <div className="text-[13px] font-medium">{value}</div>
    </div>
  );
}
