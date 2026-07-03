import { getBranding } from "@/actions/admin";
import { BrandingForm } from "./branding-form";

export default async function BrandingPage() {
  const branding = await getBranding();
  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Branding</h1>
      <BrandingForm
        initial={{
          productName: branding?.productName ?? "Support",
          primaryColor: branding?.primaryColor ?? "#FF6A00",
          accentColor: branding?.accentColor ?? "#000000",
          logoUrl: branding?.logoUrl ?? "",
          supportEmail: branding?.supportEmail ?? "",
          emailFromName: branding?.emailFromName ?? "",
        }}
      />
    </div>
  );
}
