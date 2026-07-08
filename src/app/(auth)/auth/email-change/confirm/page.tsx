import { redirect } from "next/navigation";
import { confirmEmailChange } from "@/actions/emailChange";

// M21.2 — landing page for the confirmation link emailed to the NEW
// address. Server-side action fires on load: fast path if valid (redirect
// to login), inline error if the link expired or was superseded.

export default async function ConfirmEmailChangePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  if (!token) {
    return (
      <ErrorShell message="This link is missing its token. Try requesting the change again." />
    );
  }
  const result = await confirmEmailChange({ token });
  if ("ok" in result) redirect(result.redirectTo);
  return <ErrorShell message={result.error} />;
}

function ErrorShell({ message }: { message: string }) {
  return (
    <div>
      <h1 className="text-lg font-bold mb-1">Email change</h1>
      <p className="text-sm text-[var(--color-neutral-600)] mb-6">{message}</p>
      <a
        href="/auth/login"
        className="text-sm text-[var(--color-primary)] hover:underline"
      >
        Back to sign in
      </a>
    </div>
  );
}
