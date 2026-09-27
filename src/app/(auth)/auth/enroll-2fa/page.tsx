import { Suspense } from "react";
import { EnrollmentForm } from "./enrollment-form";

// M6.1.b — landing page for forced 2FA enrollment. Reached only when a
// user with a valid password signs into a tenant that has enforceMfa=true
// but has never enrolled themselves. The 15-min token in ?token=... is
// what authenticates the anonymous enrollment surface.
export default function EnrollTwoFactorPage() {
  return (
    <div>
      <h1 className="text-lg font-semibold mb-1">Set up two-factor authentication</h1>
      <p className="text-sm text-[var(--color-neutral-600)] mb-6">
        This workspace requires 2FA before you can sign in. It only takes a minute.
      </p>
      <Suspense>
        <EnrollmentForm />
      </Suspense>
    </div>
  );
}
