import { RegisterForm } from "./register-form";

export default function RegisterPage() {
  return (
    <div>
      <p className="text-sm text-[var(--color-neutral-600)] mb-6">Submit and track support tickets.</p>
      <RegisterForm />
    </div>
  );
}
