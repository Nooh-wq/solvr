"use client";

import { useState, useTransition } from "react";
import {
  upsertIdentityProvider,
  disableIdentityProvider,
} from "@/actions/identityProviders";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";

type Provider = {
  kind: "SAML" | "OIDC";
  displayName: string;
  isActive: boolean;
  config: Record<string, unknown>;
  groupMappings: Array<{ idpGroup: string; roleName: string }>;
  defaultRoleName: string;
  autoApproveSso: boolean;
};

export function IdentityProvidersForm({
  providers,
  slug,
}: {
  providers: Provider[];
  slug: string;
}) {
  const saml = providers.find((p) => p.kind === "SAML");
  const oidc = providers.find((p) => p.kind === "OIDC");
  const origin = typeof window !== "undefined" ? window.location.origin : "";

  return (
    <div className="space-y-8 max-w-3xl">
      <div className="bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl p-6 space-y-3">
        <h2 className="text-[15px] font-semibold">Service provider metadata</h2>
        <p className="text-[13px] text-[var(--color-neutral-600)]">
          Give these to your IdP admin when registering this workspace.
        </p>
        <div className="text-[12px] space-y-1 font-mono">
          <div><span className="text-[var(--color-neutral-500)]">SAML metadata:</span> {origin}/api/auth/saml/{slug}/metadata</div>
          <div><span className="text-[var(--color-neutral-500)]">SAML ACS URL:</span> {origin}/api/auth/saml/{slug}/acs</div>
          <div><span className="text-[var(--color-neutral-500)]">OIDC redirect URI:</span> {origin}/api/auth/oidc/{slug}/callback</div>
        </div>
      </div>

      <SamlProviderCard initial={saml} />
      <OidcProviderCard initial={oidc} />
    </div>
  );
}

function SamlProviderCard({ initial }: { initial: Provider | undefined }) {
  const { toast } = useToast();
  const [entityId, setEntityId] = useState((initial?.config.entityId as string) ?? "");
  const [ssoUrl, setSsoUrl] = useState((initial?.config.ssoUrl as string) ?? "");
  const [cert, setCert] = useState("");
  const [displayName, setDisplayName] = useState(initial?.displayName ?? "Sign in with SAML");
  const [defaultRoleName, setDefaultRoleName] = useState(initial?.defaultRoleName ?? "Agent");
  const [autoApproveSso, setAutoApproveSso] = useState(initial?.autoApproveSso ?? false);
  const [isActive, setIsActive] = useState(initial?.isActive ?? true);
  const [mappings, setMappings] = useState<Array<{ idpGroup: string; roleName: string }>>(
    initial?.groupMappings ?? []
  );
  const [pending, startTransition] = useTransition();

  function save() {
    if (!cert && !initial) {
      toast({ title: "Missing IdP certificate", description: "Paste the IdP's signing certificate PEM.", variant: "error" });
      return;
    }
    startTransition(async () => {
      const r = await upsertIdentityProvider({
        displayName,
        isActive,
        config: {
          kind: "SAML",
          entityId,
          ssoUrl,
          cert: cert || "•••", // upsert-only-when-provided handled server-side in a real deploy
          wantAssertionsSigned: true,
        },
        groupMappings: mappings,
        defaultRoleName,
        autoApproveSso,
      });
      if (!r.ok) {
        toast({ title: "Couldn't save", description: r.error, variant: "error" });
        return;
      }
      setCert("");
      toast({ title: "SAML provider saved", variant: "success" });
    });
  }

  function toggleDisable() {
    startTransition(async () => {
      const r = await disableIdentityProvider({ kind: "SAML" });
      if (!r.ok) {
        toast({ title: "Couldn't disable", description: r.error, variant: "error" });
        return;
      }
      setIsActive(false);
      toast({ title: "SAML disabled", variant: "success" });
    });
  }

  return (
    <div className="bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl p-6 space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-[15px] font-semibold">SAML 2.0</h2>
          <p className="text-[13px] text-[var(--color-neutral-600)] mt-1">
            {initial ? (initial.isActive ? "Active" : "Configured but disabled") : "Not configured"}
          </p>
        </div>
        {initial?.isActive && (
          <Button type="button" variant="secondary" size="sm" onClick={toggleDisable} disabled={pending}>
            Disable
          </Button>
        )}
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="samlEntityId">IdP entity ID</Label>
        <Input id="samlEntityId" value={entityId} onChange={(e) => setEntityId(e.target.value)} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="samlSsoUrl">IdP SSO URL</Label>
        <Input id="samlSsoUrl" value={ssoUrl} onChange={(e) => setSsoUrl(e.target.value)} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="samlCert">IdP signing certificate (PEM)</Label>
        <textarea
          id="samlCert"
          value={cert}
          onChange={(e) => setCert(e.target.value)}
          placeholder={initial ? "Leave blank to keep the stored cert" : "-----BEGIN CERTIFICATE-----\n..."}
          rows={6}
          className="w-full font-mono text-[11px] bg-[var(--color-surface-muted)] border border-[var(--color-neutral-300)] rounded-lg px-2 py-1"
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="samlDisplay">Login button label</Label>
        <Input id="samlDisplay" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="samlDefaultRole">Default role for un-mapped groups</Label>
        <Input id="samlDefaultRole" value={defaultRoleName} onChange={(e) => setDefaultRoleName(e.target.value)} />
      </div>
      <div className="flex items-center gap-2">
        <input id="samlAutoApprove" type="checkbox" checked={autoApproveSso} onChange={(e) => setAutoApproveSso(e.target.checked)} />
        <label htmlFor="samlAutoApprove" className="text-[13px]">Auto-approve JIT users (skip pending queue)</label>
      </div>
      <GroupMappingEditor mappings={mappings} onChange={setMappings} />
      <Button onClick={save} disabled={pending}>
        {pending ? "Saving…" : "Save SAML config"}
      </Button>
    </div>
  );
}

function OidcProviderCard({ initial }: { initial: Provider | undefined }) {
  const { toast } = useToast();
  const [issuer, setIssuer] = useState((initial?.config.issuer as string) ?? "");
  const [clientId, setClientId] = useState((initial?.config.clientId as string) ?? "");
  const [clientSecret, setClientSecret] = useState("");
  const [displayName, setDisplayName] = useState(initial?.displayName ?? "Sign in with SSO");
  const [defaultRoleName, setDefaultRoleName] = useState(initial?.defaultRoleName ?? "Agent");
  const [autoApproveSso, setAutoApproveSso] = useState(initial?.autoApproveSso ?? false);
  const [isActive, setIsActive] = useState(initial?.isActive ?? true);
  const [mappings, setMappings] = useState<Array<{ idpGroup: string; roleName: string }>>(
    initial?.groupMappings ?? []
  );
  const [pending, startTransition] = useTransition();

  function save() {
    if (!clientSecret && !initial) {
      toast({ title: "Missing client secret", description: "Paste the OIDC client secret.", variant: "error" });
      return;
    }
    startTransition(async () => {
      const r = await upsertIdentityProvider({
        displayName,
        isActive,
        config: {
          kind: "OIDC",
          issuer,
          clientId,
          clientSecret: clientSecret || "•••",
          scopes: ["openid", "profile", "email"],
        },
        groupMappings: mappings,
        defaultRoleName,
        autoApproveSso,
      });
      if (!r.ok) {
        toast({ title: "Couldn't save", description: r.error, variant: "error" });
        return;
      }
      setClientSecret("");
      toast({ title: "OIDC provider saved", variant: "success" });
    });
  }

  function toggleDisable() {
    startTransition(async () => {
      const r = await disableIdentityProvider({ kind: "OIDC" });
      if (!r.ok) {
        toast({ title: "Couldn't disable", description: r.error, variant: "error" });
        return;
      }
      setIsActive(false);
      toast({ title: "OIDC disabled", variant: "success" });
    });
  }

  return (
    <div className="bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl p-6 space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-[15px] font-semibold">OIDC</h2>
          <p className="text-[13px] text-[var(--color-neutral-600)] mt-1">
            {initial ? (initial.isActive ? "Active" : "Configured but disabled") : "Not configured"}
          </p>
        </div>
        {initial?.isActive && (
          <Button type="button" variant="secondary" size="sm" onClick={toggleDisable} disabled={pending}>
            Disable
          </Button>
        )}
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="oidcIssuer">Issuer URL</Label>
        <Input id="oidcIssuer" value={issuer} onChange={(e) => setIssuer(e.target.value)} placeholder="https://accounts.google.com" />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="oidcClientId">Client ID</Label>
        <Input id="oidcClientId" value={clientId} onChange={(e) => setClientId(e.target.value)} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="oidcClientSecret">Client secret</Label>
        <Input
          id="oidcClientSecret"
          type="password"
          value={clientSecret}
          onChange={(e) => setClientSecret(e.target.value)}
          placeholder={initial ? "Leave blank to keep the stored secret" : ""}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="oidcDisplay">Login button label</Label>
        <Input id="oidcDisplay" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="oidcDefaultRole">Default role for un-mapped groups</Label>
        <Input id="oidcDefaultRole" value={defaultRoleName} onChange={(e) => setDefaultRoleName(e.target.value)} />
      </div>
      <div className="flex items-center gap-2">
        <input id="oidcAutoApprove" type="checkbox" checked={autoApproveSso} onChange={(e) => setAutoApproveSso(e.target.checked)} />
        <label htmlFor="oidcAutoApprove" className="text-[13px]">Auto-approve JIT users (skip pending queue)</label>
      </div>
      <GroupMappingEditor mappings={mappings} onChange={setMappings} />
      <Button onClick={save} disabled={pending}>
        {pending ? "Saving…" : "Save OIDC config"}
      </Button>
    </div>
  );
}

function GroupMappingEditor({
  mappings,
  onChange,
}: {
  mappings: Array<{ idpGroup: string; roleName: string }>;
  onChange: (next: Array<{ idpGroup: string; roleName: string }>) => void;
}) {
  function update(i: number, patch: Partial<{ idpGroup: string; roleName: string }>) {
    onChange(mappings.map((m, j) => (i === j ? { ...m, ...patch } : m)));
  }
  return (
    <div className="pt-2 border-t border-[var(--color-neutral-200)] space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-[13px] font-semibold">Group → role mappings</h3>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={() => onChange([...mappings, { idpGroup: "", roleName: "Agent" }])}
        >
          + Add mapping
        </Button>
      </div>
      {mappings.length === 0 && (
        <p className="text-[12px] text-[var(--color-neutral-500)]">
          No mappings — every user lands with the default role.
        </p>
      )}
      {mappings.map((m, i) => (
        <div key={i} className="flex gap-2 items-center">
          <Input
            className="flex-1"
            placeholder="IdP group (e.g. stralis-admins)"
            value={m.idpGroup}
            onChange={(e) => update(i, { idpGroup: e.target.value })}
          />
          <span className="text-[var(--color-neutral-500)]">→</span>
          <Input
            className="flex-1"
            placeholder="Role name (e.g. Admin)"
            value={m.roleName}
            onChange={(e) => update(i, { roleName: e.target.value })}
          />
          <button
            type="button"
            className="text-[13px] text-red-600 hover:underline"
            onClick={() => onChange(mappings.filter((_, j) => j !== i))}
          >
            Remove
          </button>
        </div>
      ))}
    </div>
  );
}
