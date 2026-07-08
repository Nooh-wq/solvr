"use client";

import { useState, useTransition } from "react";
import { inviteTicketGuest, listTicketGuests, revokeTicketGuest, type TicketGuestSummary } from "@/actions/guest";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { UserPlusIcon } from "@/components/icons";

/**
 * "People" section for a ticket's right rail — shows anyone added as a
 * guest (email-only, no account, scoped to just this ticket — see
 * actions/guest.ts) and an "Add person" flow. Used on both the agent
 * workspace and the client portal: an agent might add a developer for
 * assistance, a client might add a colleague, same mechanism either way.
 */
export function TicketPeoplePanel({
  ticketId,
  initialGuests,
  variant = "card",
}: {
  ticketId: string;
  initialGuests: TicketGuestSummary[];
  variant?: "card" | "flat";
}) {
  const { toast } = useToast();
  const [guests, setGuests] = useState(initialGuests);
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    setError(null);
    startTransition(async () => {
      const result = await inviteTicketGuest({ ticketId, email, name: name || undefined });
      if (!result.ok) {
        setError(result.error);
        toast({ title: "Couldn't add person", description: result.error, variant: "error" });
        return;
      }
      toast({ title: "Invite sent", description: email, variant: "success" });
      setEmail("");
      setName("");
      setOpen(false);
      setGuests(await listTicketGuests(ticketId));
    });
  }

  function revoke(guestId: string, label: string) {
    startTransition(async () => {
      const result = await revokeTicketGuest(guestId);
      if (!result.ok) {
        toast({ title: "Couldn't revoke access", description: result.error, variant: "error" });
        return;
      }
      toast({ title: "Access revoked", description: label, variant: "success" });
      setGuests((prev) => prev.map((g) => (g.id === guestId ? { ...g, revoked: true } : g)));
    });
  }

  return (
    <div className={
      variant === "flat"
        ? ""
        : "bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl p-4 mt-6"
    }>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-[13px] font-semibold">People</h3>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="text-[12px] font-medium text-[var(--color-primary)] hover:underline cursor-pointer flex items-center gap-1"
        >
          <UserPlusIcon className="h-3.5 w-3.5" />
          Add person
        </button>
      </div>

      {guests.length === 0 ? (
        <p className="text-[12px] text-[var(--color-neutral-500)]">No one added yet.</p>
      ) : (
        <ul className="space-y-2.5">
          {guests.map((g) => (
            <li key={g.id} className="flex items-center justify-between gap-2 text-[12px]">
              <div className="min-w-0">
                <p className={`font-medium truncate ${g.revoked ? "text-[var(--color-neutral-400)] line-through" : ""}`}>
                  {g.name || g.email}
                </p>
                {g.name && <p className="text-[var(--color-neutral-500)] truncate">{g.email}</p>}
              </div>
              {g.revoked ? (
                <span className="text-[11px] text-[var(--color-neutral-400)] shrink-0">Revoked</span>
              ) : (
                <button
                  type="button"
                  onClick={() => revoke(g.id, g.name || g.email)}
                  disabled={pending}
                  className="text-[11px] text-red-600 hover:underline shrink-0 cursor-pointer disabled:opacity-50"
                >
                  Revoke
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title="Add person">
        <p className="text-[12px] text-[var(--color-neutral-600)] mb-3">
          They&apos;ll get an email link to view and reply to just this ticket — no account needed.
        </p>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="guestEmail">Email</Label>
            <Input id="guestEmail" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@company.com" autoFocus />
          </div>
          <div className="space-y-1">
            <Label htmlFor="guestName">Name (optional)</Label>
            <Input id="guestName" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          {error && <p className="text-[13px] text-red-600">{error}</p>}
          <Button className="w-full" onClick={submit} disabled={pending || !email.trim()}>
            {pending ? "Sending…" : "Send invite"}
          </Button>
        </div>
      </Modal>
    </div>
  );
}
