import { SignupForm } from "./signup-form";

export default function SignupPage() {
  return (
    <div>
      <p className="text-sm text-[var(--color-neutral-600)] mb-6">
        Start your own workspace. You&apos;ll be the owner — invite your team, brand it, and go.
      </p>
      <SignupForm />
    </div>
  );
}
