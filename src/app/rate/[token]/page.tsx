import Image from "next/image";
import { getCsatContext } from "@/actions/csat";
import { getCurrentTenant } from "@/lib/current-tenant";
import { RatingForm } from "./rating-form";

export default async function RateTicketPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const [context, tenant] = await Promise.all([getCsatContext(token), getCurrentTenant()]);
  const productName = tenant.branding?.productName ?? "solvr";
  const logoUrl = tenant.branding?.logoUrl;

  return (
    <div className="min-h-screen app-shell-bg px-4 py-10 flex flex-col items-center">
      <div className="max-w-sm w-full">
        <div className="flex items-center gap-2 mb-8 justify-center">
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoUrl} alt="" className="h-5 w-5 object-contain" />
          ) : (
            <>
              <Image src="/brand/solvr-wordmark-black.svg" alt={productName} width={84} height={30} className="dark:hidden" />
              <Image src="/brand/solvr-wordmark-white.svg" alt={productName} width={84} height={30} className="hidden dark:block" />
            </>
          )}
          {logoUrl && <span className="text-[15px] font-semibold">{productName}</span>}
        </div>

        {!context ? (
          <div className="glass-panel rounded-2xl p-8 text-center">
            <h1 className="text-[16px] font-semibold mb-2">This link is no longer valid</h1>
            <p className="text-[13px] text-[var(--color-neutral-600)]">
              It may have expired, or the address wasn&apos;t copied correctly.
            </p>
          </div>
        ) : (
          <div className="glass-panel rounded-2xl p-8">
            <p className="font-mono text-[12px] text-[var(--color-neutral-600)] text-center mb-1">{context.ticketReference}</p>
            <h1 className="text-[18px] font-semibold text-center mb-6">{context.ticketTitle}</h1>
            <RatingForm token={token} existingRating={context.existingRating} />
          </div>
        )}
      </div>
    </div>
  );
}
