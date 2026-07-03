"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateBranding, uploadBrandingLogo } from "@/actions/admin";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { HomeIcon, TicketIcon, UsersIcon, BellIcon } from "@/components/icons";

type BrandingValues = {
  productName: string;
  primaryColor: string;
  accentColor: string;
  logoUrl: string;
  supportEmail: string;
  emailFromName: string;
};

export function BrandingForm({ initial }: { initial: BrandingValues }) {
  const router = useRouter();
  const { toast } = useToast();
  const [values, setValues] = useState(initial);
  const [warning, setWarning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploading, startUploadTransition] = useTransition();
  const fileInputRef = useRef<HTMLInputElement>(null);

  function set<K extends keyof BrandingValues>(key: K, value: BrandingValues[K]) {
    setValues((v) => ({ ...v, [key]: value }));
  }

  function onFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadError(null);
    const formData = new FormData();
    formData.set("file", file);
    startUploadTransition(async () => {
      const result = await uploadBrandingLogo(formData);
      if (!result.ok) {
        setUploadError(result.error);
        toast({ title: "Logo upload failed", description: result.error, variant: "error" });
        return;
      }
      set("logoUrl", result.url);
      toast({ title: "Logo ready — click Save branding to apply", variant: "info" });
    });
    e.target.value = "";
  }

  function onSubmit() {
    setError(null);
    setWarning(null);
    startTransition(async () => {
      try {
        const result = await updateBranding(values);
        if (result.contrastWarning) setWarning(result.contrastWarning);
        toast({
          title: "Branding saved",
          description: result.contrastWarning ?? undefined,
          variant: result.contrastWarning ? "info" : "success",
        });
        router.refresh();
      } catch (e) {
        const message = e instanceof Error ? e.message : "Could not save branding.";
        setError(message);
        toast({ title: "Couldn't save branding", description: message, variant: "error" });
      }
    });
  }

  return (
    <div className="grid grid-cols-2 gap-6 max-w-3xl">
      <div className="bg-white border border-[var(--color-neutral-300)] rounded p-5 space-y-3">
        <div className="space-y-1">
          <Label htmlFor="productName">Product name</Label>
          <Input id="productName" value={values.productName} onChange={(e) => set("productName", e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label htmlFor="primaryColor">Primary color</Label>
            <div className="flex gap-2 items-center">
              <input
                type="color"
                value={values.primaryColor}
                onChange={(e) => set("primaryColor", e.target.value)}
                className="h-10 w-10 border border-[var(--color-neutral-300)] rounded"
              />
              <Input value={values.primaryColor} onChange={(e) => set("primaryColor", e.target.value)} />
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="accentColor">Accent color</Label>
            <div className="flex gap-2 items-center">
              <input
                type="color"
                value={values.accentColor}
                onChange={(e) => set("accentColor", e.target.value)}
                className="h-10 w-10 border border-[var(--color-neutral-300)] rounded"
              />
              <Input value={values.accentColor} onChange={(e) => set("accentColor", e.target.value)} />
            </div>
          </div>
        </div>
        <div className="space-y-1">
          <Label htmlFor="logoUrl">Logo</Label>
          <div className="flex gap-2 items-center">
            <Input id="logoUrl" value={values.logoUrl} onChange={(e) => set("logoUrl", e.target.value)} placeholder="https://…" />
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={onFileSelected}
            />
            <Button type="button" variant="secondary" size="sm" disabled={uploading} onClick={() => fileInputRef.current?.click()}>
              {uploading ? "Uploading…" : "Upload"}
            </Button>
          </div>
          <p className="text-[11px] text-[var(--color-neutral-500)]">PNG, JPEG, or WEBP — up to 2MB.</p>
          {uploadError && <p className="text-[12px] text-red-600">{uploadError}</p>}
        </div>
        <div className="space-y-1">
          <Label htmlFor="supportEmail">Support email (reply-to)</Label>
          <Input id="supportEmail" value={values.supportEmail} onChange={(e) => set("supportEmail", e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="emailFromName">Email from-name</Label>
          <Input id="emailFromName" value={values.emailFromName} onChange={(e) => set("emailFromName", e.target.value)} />
        </div>
        {warning && <p className="text-[12px] text-[var(--color-orange-deep)]">{warning}</p>}
        {error && <p className="text-[13px] text-red-600">{error}</p>}
        <Button onClick={onSubmit} disabled={pending}>
          {pending ? "Saving…" : "Save branding"}
        </Button>
      </div>

      <div>
        <p className="uppercase-label text-[11px] text-[var(--color-neutral-600)] mb-2">Live preview</p>
        <p className="text-[12px] text-[var(--color-neutral-500)] mb-3">
          A snapshot of the platform with your changes — updates instantly as you edit.
        </p>
        <PlatformPreview values={values} />
      </div>
    </div>
  );
}

const PREVIEW_NAV = [
  { label: "Overview", icon: HomeIcon },
  { label: "Queue", icon: TicketIcon },
  { label: "Team", icon: UsersIcon },
];

const PREVIEW_TICKETS: { ref: string; title: string; status: string }[] = [
  { ref: "SO-2481", title: "Can't reset my password", status: "Open" },
  { ref: "SO-2480", title: "Invoice question for March", status: "Pending" },
  { ref: "SO-2477", title: "Feature request: dark mode", status: "In progress" },
];

/**
 * A miniature, non-interactive mockup of the real app shell (browser chrome +
 * sidebar + queue list), styled with the in-progress form values so it reads
 * as "here's what the product will actually look like" rather than an
 * abstract swatch of button/badge/text like the old preview.
 */
function PlatformPreview({ values }: { values: BrandingValues }) {
  const slug = (values.productName.toLowerCase().replace(/[^a-z0-9]+/g, "") || "yourcompany") + ".solvr.app";

  return (
    <div className="rounded-2xl border border-[var(--color-neutral-300)] shadow-[0_16px_48px_-12px_rgba(0,0,0,0.18)] overflow-hidden bg-white select-none">
      {/* Browser chrome */}
      <div className="h-8 bg-[var(--color-neutral-100)] border-b border-[var(--color-neutral-200)] flex items-center gap-1.5 px-3 shrink-0">
        <span className="h-2.5 w-2.5 rounded-full bg-red-300" />
        <span className="h-2.5 w-2.5 rounded-full bg-yellow-300" />
        <span className="h-2.5 w-2.5 rounded-full bg-green-300" />
        <div className="ml-2 flex-1 h-5 rounded-full bg-white border border-[var(--color-neutral-200)] flex items-center px-2.5 min-w-0">
          <span className="text-[10px] text-[var(--color-neutral-500)] truncate">{slug}</span>
        </div>
      </div>

      <div className="flex h-[360px]">
        {/* Mini sidebar */}
        <div className="w-[112px] shrink-0 border-r border-[var(--color-neutral-200)] bg-white flex flex-col">
          <div className="h-11 flex items-center gap-1.5 px-2.5 border-b border-black/5 min-w-0">
            {values.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={values.logoUrl} alt="" className="h-4 w-4 shrink-0 object-contain rounded" />
            ) : (
              <div className="h-4 w-4 shrink-0 rounded" style={{ backgroundColor: values.accentColor }} />
            )}
            <span className="text-[10px] font-semibold truncate">{values.productName || "Support"}</span>
          </div>
          <div className="flex-1 py-2 px-2 space-y-1">
            {PREVIEW_NAV.map((item, i) => (
              <div
                key={item.label}
                className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[9px] font-medium"
                style={
                  i === 1
                    ? { backgroundColor: values.primaryColor, color: "#fff" }
                    : { color: "var(--color-neutral-600)" }
                }
              >
                <item.icon className="h-3 w-3 shrink-0" />
                <span className="truncate">{item.label}</span>
              </div>
            ))}
          </div>
          <div className="px-2 py-2 border-t border-black/5">
            <div className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[9px] font-medium text-[var(--color-neutral-600)]">
              <BellIcon className="h-3 w-3 shrink-0" />
              <span className="truncate">Notifications</span>
            </div>
          </div>
        </div>

        {/* Main content */}
        <div className="flex-1 min-w-0 flex flex-col bg-[var(--color-neutral-50,#fafafa)]">
          <div className="h-11 flex items-center justify-between px-3.5 border-b border-black/5 bg-white shrink-0">
            <span className="text-[11px] font-semibold">Queue</span>
            <span
              className="rounded-full px-2.5 py-1 text-[9px] font-medium text-white"
              style={{ backgroundColor: values.primaryColor }}
            >
              + New ticket
            </span>
          </div>
          <div className="flex-1 p-3 space-y-2 overflow-hidden">
            {PREVIEW_TICKETS.map((t) => (
              <div
                key={t.ref}
                className="bg-white border border-[var(--color-neutral-200)] rounded-lg px-3 py-2 flex items-center justify-between gap-2"
              >
                <div className="min-w-0">
                  <p className="text-[9px] font-mono" style={{ color: values.primaryColor }}>
                    {t.ref}
                  </p>
                  <p className="text-[10px] font-medium truncate">{t.title}</p>
                </div>
                <span
                  className="shrink-0 rounded-full px-2 py-0.5 text-[9px] font-medium"
                  style={{ backgroundColor: values.accentColor + "1a", color: values.accentColor }}
                >
                  {t.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
