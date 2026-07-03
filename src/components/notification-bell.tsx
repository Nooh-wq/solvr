"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import {
  listNotifications,
  getNotificationSnapshot,
  markNotificationRead,
  markAllNotificationsRead,
} from "@/actions/notifications";
import { BellIcon } from "@/components/icons";
import { useToast } from "@/components/ui/toast";

type Notification = {
  id: string;
  type: string;
  title: string;
  body: string | null;
  href: string | null;
  isRead: boolean;
  createdAt: Date;
};

const POLL_MS = 30_000;

function timeAgo(date: Date) {
  const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/**
 * Bell trigger + dropdown, polled every 30s for the unread count.
 * `variant="sidebar"` renders as a full-width row (matches the nav links
 * above it) with the panel opening to the right, since the trigger now
 * lives against the left edge of the screen instead of a top bar.
 */
export function NotificationBell({
  variant = "topbar",
  collapsed = false,
}: {
  variant?: "topbar" | "sidebar";
  collapsed?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[] | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [, startTransition] = useTransition();
  const containerRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();
  // IDs already seen (toasted or otherwise known about), so a poll only alerts
  // on notifications that are genuinely new since the last check — not on
  // every poll tick, and not on the very first load (nothing "arrived" then,
  // it was just already there).
  const seenIds = useRef<Set<string> | null>(null);

  // One poll = one server action = one DB transaction. This both refreshes the
  // unread badge count AND detects newly-arrived notifications to toast, so the
  // bell never fires two transactions racing for the same pooled connection
  // (the old refreshCount + checkForNew pair was the main source of the P2028
  // errors when opening/hitting notifications).
  const poll = useCallback(async () => {
    let snapshot;
    try {
      snapshot = await getNotificationSnapshot();
    } catch {
      // A transient network/DB hiccup shouldn't surface as an error toast on a
      // background poll — just skip this tick; the next one recovers.
      return;
    }
    setUnreadCount(snapshot.unreadCount);

    if (seenIds.current === null) {
      // First check ever: just record what's already there, don't toast it.
      seenIds.current = new Set(snapshot.notifications.map((n) => n.id));
      return;
    }
    const fresh = snapshot.notifications.filter((n) => !seenIds.current!.has(n.id));
    for (const n of fresh) {
      toast({ title: n.title, description: n.body ?? undefined, variant: "info" });
      seenIds.current.add(n.id);
    }
  }, [toast]);

  useEffect(() => {
    poll();
    const interval = setInterval(poll, POLL_MS);
    return () => clearInterval(interval);
  }, [poll]);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next) startTransition(async () => setNotifications(await listNotifications()));
  }

  function onClickNotification(n: Notification) {
    if (!n.isRead) {
      setNotifications((prev) => prev?.map((x) => (x.id === n.id ? { ...x, isRead: true } : x)) ?? null);
      setUnreadCount((c) => Math.max(0, c - 1));
      markNotificationRead(n.id);
    }
    setOpen(false);
  }

  function markAllRead() {
    setNotifications((prev) => prev?.map((n) => ({ ...n, isRead: true })) ?? null);
    setUnreadCount(0);
    markAllNotificationsRead();
  }

  const isSidebar = variant === "sidebar";

  const panel = (
    <div
      className={`${
        isSidebar ? "absolute left-0 bottom-full mb-2" : "absolute right-0 mt-2"
      } w-80 bg-white/85 backdrop-blur-xl border border-white/60 rounded-2xl shadow-[0_16px_48px_-12px_rgba(0,0,0,0.25)] z-50 overflow-hidden animate-[fadeIn_150ms_ease-out]`}
    >
      <div className="flex items-center justify-between px-4 py-3 border-b border-black/5">
        <span className="text-[13px] font-semibold">Notifications</span>
        {notifications?.some((n) => !n.isRead) && (
          <button onClick={markAllRead} className="text-[12px] text-[var(--color-neutral-600)] hover:text-black cursor-pointer transition-colors">
            Mark all read
          </button>
        )}
      </div>
      <div className="max-h-96 overflow-y-auto">
        {notifications === null && <p className="p-4 text-[13px] text-[var(--color-neutral-600)]">Loading…</p>}
        {notifications?.length === 0 && <p className="p-4 text-[13px] text-[var(--color-neutral-600)]">No notifications yet.</p>}
        {notifications?.map((n) => {
          const body = (
            <div
              className={`px-4 py-3 border-b border-black/5 last:border-0 transition-colors duration-150 hover:bg-black/[0.03] ${
                n.isRead ? "" : "bg-[var(--color-orange-pale)]/70"
              }`}
            >
              <p className="text-[13px] font-medium text-black">{n.title}</p>
              {n.body && <p className="text-[12px] text-[var(--color-neutral-600)] mt-0.5 line-clamp-2">{n.body}</p>}
              <p className="text-[11px] text-[var(--color-neutral-400)] mt-1">{timeAgo(n.createdAt)}</p>
            </div>
          );
          return n.href ? (
            <Link key={n.id} href={n.href} onClick={() => onClickNotification(n)} className="block cursor-pointer">
              {body}
            </Link>
          ) : (
            <button key={n.id} onClick={() => onClickNotification(n)} className="block w-full text-left cursor-pointer">
              {body}
            </button>
          );
        })}
      </div>
    </div>
  );

  if (isSidebar) {
    return (
      <div className="relative" ref={containerRef}>
        <button
          onClick={toggle}
          aria-label="Notifications"
          className={`group flex items-center gap-3 rounded-xl px-3 py-2.5 text-[13px] font-medium w-full transition-all duration-150 cursor-pointer text-[var(--color-neutral-700)] hover:bg-black/[0.045] hover:text-black ${
            collapsed ? "justify-center px-0" : ""
          }`}
        >
          <span className="relative shrink-0">
            <BellIcon className="h-[18px] w-[18px] transition-transform duration-150 group-hover:scale-110" />
            {unreadCount > 0 && (
              <span className="absolute -top-1 -right-1 h-3.5 min-w-3.5 px-0.5 rounded-full bg-[var(--color-primary)] text-white text-[9px] font-semibold leading-3.5 text-center">
                {unreadCount > 9 ? "9+" : unreadCount}
              </span>
            )}
          </span>
          {!collapsed && <span>Notifications</span>}
        </button>
        {open && panel}
      </div>
    );
  }

  return (
    <div className="relative" ref={containerRef}>
      <button
        onClick={toggle}
        aria-label="Notifications"
        className="relative h-8 w-8 flex items-center justify-center rounded-full text-[var(--color-neutral-700)] hover:bg-[var(--color-light-gray)] hover:text-black cursor-pointer transition-colors duration-150"
      >
        <BellIcon className="h-[18px] w-[18px]" />
        {unreadCount > 0 && (
          <span className="absolute top-0.5 right-0.5 h-3.5 min-w-3.5 px-0.5 rounded-full bg-[var(--color-primary)] text-white text-[9px] font-semibold leading-3.5 text-center">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>
      {open && panel}
    </div>
  );
}
