import { Suspense } from "react";
import { AcceptInviteForm } from "./accept-invite-form";

export default function AcceptInvitePage() {
  return (
    <div>
      <h1 className="text-lg font-bold mb-1">Set up your account</h1>
      <p className="text-sm text-[var(--color-neutral-600)] mb-6">Choose a password to finish accepting your invite.</p>
      <Suspense>
        <AcceptInviteForm />
      </Suspense>
    </div>
  );
}
