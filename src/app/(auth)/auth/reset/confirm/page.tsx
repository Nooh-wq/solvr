import { ConfirmResetForm } from "./confirm-reset-form";

export default function ConfirmResetPage() {
  return (
    <div>
      <h1 className="text-lg font-bold mb-1">Set a new password</h1>
      <p className="text-sm text-[var(--color-neutral-600)] mb-6">Choose a new password for your account.</p>
      <ConfirmResetForm />
    </div>
  );
}
