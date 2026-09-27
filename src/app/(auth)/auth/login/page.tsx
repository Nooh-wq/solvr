import Link from "next/link";
import { Suspense } from "react";
import { LoginForm } from "./login-form";
import { withRls } from "@/lib/db";
import { getCurrentTenant } from "@/lib/current-tenant";

async function getActiveIdps(): Promise<Array<{ kind: "SAML" | "OIDC"; displayName: string }>> {
  try {
    const tenant = await getCurrentTenant();
    const rows = await withRls(
      { tenantId: tenant.id, userId: null, role: "SUPER_ADMIN" as const },
      (tx) =>
        tx.tenantIdentityProvider.findMany({
          where: { tenantId: tenant.id, isActive: true },
          select: { kind: true, displayName: true },
          orderBy: { kind: "asc" },
        })
    );
    return rows.map((r) => ({ kind: r.kind as "SAML" | "OIDC", displayName: r.displayName }));
  } catch {
    return [];
  }
}

export default async function LoginPage() {
  const [idps, tenant] = await Promise.all([getActiveIdps(), getCurrentTenant().catch(() => null)]);
  const slug = tenant?.slug ?? "";
  const enforceSso = tenant?.enforceSso ?? false;
  return (
    <div>
      <p className="text-sm text-[var(--color-neutral-600)] mb-6">Access your support tickets.</p>
      {idps.length > 0 && (
        <div className="space-y-2 mb-4">
          {idps.map((idp) => (
            <a
              key={idp.kind}
              href={`/api/auth/${idp.kind.toLowerCase()}/${slug}/init`}
              className="block w-full text-center px-4 py-2 border border-[var(--color-neutral-300)] rounded-lg text-[13px] font-medium hover:bg-[var(--color-surface-muted)] transition-colors"
            >
              {idp.displayName}
            </a>
          ))}
          {!enforceSso && (
            <div className="flex items-center gap-3 py-2">
              <div className="flex-1 h-px bg-[var(--color-neutral-200)]" />
              <span className="text-[11px] text-[var(--color-neutral-500)] uppercase tracking-wide">or</span>
              <div className="flex-1 h-px bg-[var(--color-neutral-200)]" />
            </div>
          )}
        </div>
      )}
      {enforceSso && idps.length > 0 ? (
        <p className="text-[12px] text-[var(--color-neutral-500)]">
          Email/password sign-in is disabled for this workspace. Use the button above.
        </p>
      ) : (
        <Suspense>
          <LoginForm />
        </Suspense>
      )}
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
