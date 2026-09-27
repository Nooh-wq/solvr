import { listScimTokens } from "@/actions/scimTokens";
import { ScimEditor } from "./scim-editor";

export const dynamic = "force-dynamic";

export default async function ScimPage() {
  const tokens = await listScimTokens();
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  return (
    <div>
      <h1 className="text-2xl font-bold mb-1">SCIM provisioning</h1>
      <p className="text-sm text-[var(--color-neutral-600)] mb-6 max-w-2xl">
        Automatically create, update, and deprovision users from your identity provider (Okta,
        Azure AD, Google Workspace, JumpCloud). Configure a SCIM 2.0 endpoint in your IdP with
        the URL and bearer token below.
      </p>

      <div className="grid gap-3 md:grid-cols-2 mb-6">
        <div className="p-4 bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl">
          <div className="text-[11px] uppercase-label text-[var(--color-neutral-600)] mb-1">SCIM base URL</div>
          <code className="text-[12px] font-mono break-all">{baseUrl}/api/scim/v2</code>
        </div>
        <div className="p-4 bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl">
          <div className="text-[11px] uppercase-label text-[var(--color-neutral-600)] mb-1">Auth header</div>
          <code className="text-[12px] font-mono">Authorization: Bearer &lt;token&gt;</code>
        </div>
      </div>

      <ScimEditor initialTokens={tokens} />
    </div>
  );
}
