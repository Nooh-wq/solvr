// M15.6 — marketing landing for "Stralis for Employee Service".
// Public route (added to PUBLIC_PREFIXES). Distinct URL so the
// employee-preset signup gets its own analytics-friendly path.

import Link from "next/link";

export const metadata = {
  title: "Stralis for Employee Service",
  description:
    "Internal IT + HR service desk. Same engine, tuned for employees: service catalog, approvals, assets.",
};

const FEATURES = [
  {
    icon: "🧾",
    title: "Service Catalog",
    body: "Predefined request types with dynamic forms — new laptop, access request, onboarding.",
  },
  {
    icon: "✅",
    title: "Multi-step Approvals",
    body: "Route requests through manager → system-owner sign-off. Auto-escalate on inactivity.",
  },
  {
    icon: "💻",
    title: "Asset Registry",
    body: "Track laptops, monitors, licenses, and access; link them to fulfilment tickets.",
  },
  {
    icon: "🔁",
    title: "Reversible Preset",
    body: "Toggle Service Mode any time. Data stays; only terminology + navigation change.",
  },
];

export default function EmployeeServiceLanding() {
  return (
    <div className="min-h-screen app-shell-bg">
      <div className="max-w-5xl mx-auto px-6 py-16">
        <div className="text-[12px] uppercase-label text-[var(--color-primary)] mb-3">
          Stralis for Employee Service
        </div>
        <h1 className="text-4xl md:text-5xl font-bold mb-4 max-w-3xl">
          Support your employees the way you support customers.
        </h1>
        <p className="text-lg text-[var(--color-neutral-700)] mb-8 max-w-2xl">
          One engine, two products. Flip a switch to run internal IT and HR requests on the same platform your
          support team already knows.
        </p>
        <div className="flex gap-3 mb-16">
          <Link
            href="/auth/signup?mode=employee"
            className="inline-flex items-center h-11 px-5 rounded-md bg-[var(--color-primary)] text-white text-[14px] font-medium hover:opacity-90"
          >
            Start free trial
          </Link>
          <Link
            href="/auth/signup"
            className="inline-flex items-center h-11 px-5 rounded-md border border-[var(--color-neutral-300)] text-[14px] font-medium hover:border-[var(--color-neutral-500)]"
          >
            Customer support instead
          </Link>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-16">
          {FEATURES.map((f) => (
            <div
              key={f.title}
              className="bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl p-6"
            >
              <div className="text-3xl mb-3">{f.icon}</div>
              <div className="text-[15px] font-semibold mb-1">{f.title}</div>
              <div className="text-[13px] text-[var(--color-neutral-600)]">{f.body}</div>
            </div>
          ))}
        </div>

        <div className="bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl p-6 max-w-3xl">
          <div className="text-[12px] uppercase-label text-[var(--color-neutral-700)] mb-2">
            The same engine, new preset
          </div>
          <div className="text-[13px] text-[var(--color-neutral-700)] space-y-2">
            <p>
              Everything you get in customer support — rules, SLAs, routing, AI, analytics, roles, groups — is
              already here. Employee Service adds a service catalog, generalized approvals, and asset tracking
              on top.
            </p>
            <p>
              A tenant can flip between modes any time. Your existing tickets don&apos;t move; only labels and
              default navigation change.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
