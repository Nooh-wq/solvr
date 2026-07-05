"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/** Login/Register segmented switcher shown above the auth form. Renders
 * nothing on reset/invite-accept pages, where a two-way tab doesn't apply. */
export function AuthTabs() {
  const pathname = usePathname();
  const isLogin = pathname.startsWith("/auth/login");
  const isRegister = pathname.startsWith("/auth/register");

  if (!isLogin && !isRegister) return null;

  return (
    <div className="relative grid grid-cols-2 gap-1 p-1 rounded-xl bg-black/[0.04] dark:bg-white/[0.06] mb-6">
      <span
        className="absolute inset-y-1 left-1 w-[calc(50%-4px)] rounded-lg bg-[var(--color-surface)] shadow-[0_2px_10px_-2px_rgba(0,0,0,0.15)] transition-transform duration-200 ease-out"
        style={{ transform: isRegister ? "translateX(calc(100% + 4px))" : "translateX(0)" }}
      />
      <Link
        href="/auth/login"
        className={`relative z-10 text-center py-2 text-[13px] font-semibold rounded-lg transition-colors duration-150 cursor-pointer ${
          isLogin ? "text-[var(--foreground)]" : "text-[var(--color-neutral-500)] hover:text-[var(--foreground)]"
        }`}
      >
        Log in
      </Link>
      <Link
        href="/auth/register"
        className={`relative z-10 text-center py-2 text-[13px] font-semibold rounded-lg transition-colors duration-150 cursor-pointer ${
          isRegister ? "text-[var(--foreground)]" : "text-[var(--color-neutral-500)] hover:text-[var(--foreground)]"
        }`}
      >
        Register
      </Link>
    </div>
  );
}
