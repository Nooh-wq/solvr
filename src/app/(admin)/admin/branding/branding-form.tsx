"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateBranding, uploadBrandingLogo } from "@/actions/admin";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";

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
        return;
      }
      set("logoUrl", result.url);
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
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not save branding.");
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
        <div className="bg-white border border-[var(--color-neutral-300)] rounded overflow-hidden">
          <div className="h-12 border-b border-[var(--color-neutral-300)] flex items-center px-4 gap-2">
            {values.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={values.logoUrl} alt="" className="h-5 w-5 object-contain" />
            ) : (
              <div className="h-5 w-5 rounded" style={{ backgroundColor: values.accentColor }} />
            )}
            <span className="text-[13px] font-semibold">{values.productName}</span>
          </div>
          <div className="p-5 space-y-3">
            <button
              className="rounded-full px-4 py-2 text-[13px] font-medium text-white"
              style={{ backgroundColor: values.primaryColor }}
            >
              Primary button
            </button>
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-medium" style={{ backgroundColor: values.primaryColor + "22", color: values.primaryColor }}>
                Sample badge
              </span>
            </div>
            <p className="text-sm" style={{ color: values.accentColor }}>
              Sample text in the accent color.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
