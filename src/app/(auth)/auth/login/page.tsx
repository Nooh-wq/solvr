import Link from "next/link";
import { Suspense } from "react";
import { LoginForm } from "./login-form";

export default function LoginPage() {
  return (
    <div>
      <p className="text-sm text-[var(--color-neutral-600)] mb-6">Access your support tickets.</p>
      <Suspense>
        <LoginForm />
      </Suspense>
      <p className="text-[13px] text-[var(--color-neutral-600)] mt-6 text-center">
        <Link href="/auth/reset" className="text-[var(--color-primary)] font-medium">
          Forgot password?
        </Link>
      </p>
    </div>
  );
}
