import Link from "next/link";
import { Suspense } from "react";
import { LoginForm } from "./login-form";

export default function LoginPage() {
  return (
    <div>
      <h1 className="text-lg font-bold mb-1">Log in</h1>
      <p className="text-sm text-[var(--color-neutral-600)] mb-6">Access your support tickets.</p>
      <Suspense>
        <LoginForm />
      </Suspense>
      <p className="text-[13px] text-[var(--color-neutral-600)] mt-6">
        No account?{" "}
        <Link href="/auth/register" className="text-[var(--color-primary)] font-medium">
          Register
        </Link>
        {" · "}
        <Link href="/auth/reset" className="text-[var(--color-primary)] font-medium">
          Forgot password
        </Link>
      </p>
    </div>
  );
}
