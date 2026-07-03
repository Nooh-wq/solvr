import Image from "next/image";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { getCurrentTenant } from "@/lib/current-tenant";

export default async function Home() {
  const tenant = await getCurrentTenant();
  const logoUrl = tenant.branding?.logoUrl;
  const productName = tenant.branding?.productName;

  return (
    <div className="flex flex-1 flex-col items-center justify-center app-shell-bg px-6">
      <div className="flex flex-col items-center text-center max-w-md animate-[fadeIn_400ms_ease-out]">
        {logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logoUrl} alt="" className="h-7 w-7 object-contain mb-6" />
        ) : (
          <Image src="/brand/solvr-wordmark-black.svg" alt={productName ?? "solvr"} width={120} height={43} className="mb-6" />
        )}
        <h1 className="text-2xl font-bold mb-2">{productName ? `${productName} support, handled.` : "Support, handled."}</h1>
        <p className="text-sm text-[var(--color-neutral-600)] mb-8">
          Submit a request, track its status, and hear back from a real person.
        </p>
        <div className="flex gap-3">
          <Link href="/auth/login">
            <Button>Log in</Button>
          </Link>
          <Link href="/auth/register">
            <Button variant="secondary">Register</Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
