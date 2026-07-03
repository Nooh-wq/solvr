import Image from "next/image";
import { getCurrentTenant } from "@/lib/current-tenant";

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const tenant = await getCurrentTenant();
  const productName = tenant.branding?.productName ?? "solvr";
  const logoUrl = tenant.branding?.logoUrl;

  return (
    <div className="min-h-screen flex flex-col items-center justify-center app-shell-bg px-4">
      <div className="w-full max-w-sm animate-[fadeIn_300ms_ease-out]">
        <div className="flex items-center gap-2 mb-8 justify-center">
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoUrl} alt="" className="h-5 w-5 object-contain" />
          ) : (
            <Image src="/brand/solvr-wordmark-black.svg" alt={productName} width={84} height={30} />
          )}
          {logoUrl && <span className="text-[15px] font-semibold">{productName}</span>}
        </div>
        <div className="glass-panel rounded-2xl p-8 shadow-[0_24px_64px_-24px_rgba(0,0,0,0.18)]">{children}</div>
      </div>
    </div>
  );
}
