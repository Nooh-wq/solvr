import Image from "next/image";
import { getGuestTicketView, getGuestTicketMessages } from "@/actions/guest";
import { getCurrentTenant } from "@/lib/current-tenant";
import { ConversationThread } from "@/components/conversation-thread";
import { participantNames } from "@/lib/participants";
import { StatusBadge, PriorityLabel } from "@/components/ui/badge";
import { GuestReplyBox } from "./guest-reply-box";
import type { TicketStatus, Priority } from "@/generated/prisma";

export default async function GuestTicketPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const [view, tenant] = await Promise.all([getGuestTicketView(token), getCurrentTenant()]);
  const productName = tenant.branding?.productName ?? "solvr";
  const logoUrl = tenant.branding?.logoUrl;
  const mentionNames = view ? participantNames(view.clientName, view.messages) : [];

  return (
    <div className="min-h-screen app-shell-bg px-4 py-10">
      <div className="max-w-2xl mx-auto">
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

        {!view ? (
          <div className="glass-panel rounded-2xl p-8 text-center">
            <h1 className="text-[16px] font-semibold mb-2">This link is no longer valid</h1>
            <p className="text-[13px] text-[var(--color-neutral-600)]">
              It may have been revoked, or the address wasn&apos;t copied correctly. Ask whoever added you here to send a new invite.
            </p>
          </div>
        ) : (
          <>
            <div className="flex items-start justify-between mb-4">
              <div className="min-w-0">
                <span className="font-mono text-[12px] text-[var(--color-neutral-600)]">{view.reference}</span>
                <h1 className="text-2xl font-bold truncate">{view.title}</h1>
                <p className="text-[13px] text-[var(--color-neutral-600)] mt-0.5">
                  You&apos;re viewing this as a guest — {view.guestName}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <PriorityLabel priority={view.priority as Priority} size="lg" />
                <StatusBadge status={view.status as TicketStatus} size="lg" />
              </div>
            </div>

            <ConversationThread
              description={view.description}
              clientName={view.clientName}
              mySenderRoles={["GUEST"]}
              messages={view.messages}
              mentionNames={mentionNames}
              onPoll={getGuestTicketMessages.bind(null, token)}
              composer={<GuestReplyBox token={token} mentionNames={mentionNames} />}
            />
          </>
        )}
      </div>
    </div>
  );
}
