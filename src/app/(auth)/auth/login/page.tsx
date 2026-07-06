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
      <p className="text-[12px] text-[var(--color-neutral-500)] mt-3 text-center">
        Need a workspace?{" "}
        <Link href="/auth/signup" className="text-[var(--foreground)] font-medium hover:underline">
          Start one
        </Link>
      </p>
    </div>
  );
}
