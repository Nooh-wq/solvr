"use client";

// Z4.5 stub — disabled SLA + business-hours override selectors on the
// org detail page. The columns exist in organization_settings (so M2
// can flip enforcement on with no schema change), but the UI is
// intentionally disabled with an explanation until M2 (SLA engine)
// ships. Spec §3: "do not fake it".

import { Select } from "@/components/ui/input";

export function SlaBusinessHoursStub({
  slaPolicyId,
  businessHoursId,
}: {
  slaPolicyId: string | null;
  businessHoursId: string | null;
}) {
  return (
    <div className="bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl p-5 space-y-4">
      <h2 className="text-[13px] font-semibold">SLA & business hours</h2>
      <Field
        label="Assigned SLA policy"
        currentValue={slaPolicyId ? `Custom (id: ${slaPolicyId.slice(0, 8)}…)` : null}
        placeholder="SLA engine not yet enabled"
      />
      <Field
        label="Business-hours override"
        currentValue={businessHoursId ? `Custom (id: ${businessHoursId.slice(0, 8)}…)` : null}
        placeholder="Business hours engine not yet enabled"
      />
      <p className="text-[11px] text-[var(--color-neutral-500)] pt-1">
        These take effect when M2 (SLA engine) ships. Settings you configure now are stored but not enforced.
      </p>
    </div>
  );
}

function Field({
  label,
  currentValue,
  placeholder,
}: {
  label: string;
  currentValue: string | null;
  placeholder: string;
}) {
  return (
    <div>
      <label className="text-[11px] font-semibold text-[var(--color-neutral-600)] uppercase tracking-wide">
        {label}
      </label>
      <Select disabled className="mt-1 h-9">
        <option>{currentValue ?? placeholder}</option>
      </Select>
    </div>
  );
}
