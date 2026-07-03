import Link from "next/link";
import { RegisterForm } from "./register-form";

export default function RegisterPage() {
  return (
    <div>
      <h1 className="text-lg font-bold mb-1">Create an account</h1>
      <p className="text-sm text-[var(--color-neutral-600)] mb-6">Submit and track support tickets.</p>
      <RegisterForm />
      <p className="text-[13px] text-[var(--color-neutral-600)] mt-6">
        Already have an account?{" "}
        <Link href="/auth/login" className="text-[var(--color-primary)] font-medium">
          Log in
        </Link>
      </p>
    </div>
  );
}
