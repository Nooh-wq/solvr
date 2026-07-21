import Link from "next/link";
import { requireSession } from "@/lib/auth";
import { withRls } from "@/lib/db";
import { EmailChannelEditor } from "./email-channel-editor";

export const dynamic = "force-dynamic";

export default async function EmailChannelPage() {
  const session = await requireSession({ minRole: "ADMIN" });
  const branding = await withRls(
    { tenantId: session.tenantId, userId: session.subjectId, role: session.role },
    (tx) =>
      tx.tenantBranding.upsert({
        where: { tenantId: session.tenantId },
        create: { tenantId: session.tenantId },
        update: {},
        select: {
          supportEmail: true,
          emailFromName: true,
          emailDomain: true,
          productName: true,
        },
      })
  );

  return (
    <div>
      <h1 className="text-2xl font-bold mb-1">Email channels</h1>
      <p className="text-sm text-[var(--color-neutral-600)] mb-6 max-w-2xl">
        Set up the address customers email to open a ticket, and the &ldquo;from&rdquo; identity
        Solvr uses when replying. Configured with your own domain via Resend &mdash; verify DNS
        once, and inbound + outbound both route through it.
      </p>

      <EmailChannelEditor
        initialSupportEmail={branding.supportEmail ?? ""}
        initialEmailFromName={branding.emailFromName ?? branding.productName}
        initialEmailDomain={branding.emailDomain ?? ""}
      />

      <div className="mt-6 p-4 rounded-2xl bg-[var(--color-neutral-100)] text-[12px] text-[var(--color-neutral-700)] max-w-3xl">
        <div className="font-semibold text-[13px] mb-1">How inbound works</div>
        Add MX / verification records for the domain you want to receive email at. When someone
        emails your <code className="text-[11px]">supportEmail</code>, Solvr creates a ticket and
        auto-creates a customer account for the sender (pending admin approval per your{" "}
        <Link href="/admin/people/pending" className="underline">
          registration approvals
        </Link>{" "}
        rules). Replies from agents go out from the same address so threading stays intact in the
        customer&apos;s inbox.
      </div>
    </div>
  );
}
