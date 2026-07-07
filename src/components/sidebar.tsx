"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { NotificationBell } from "@/components/notification-bell";
import { UserMenu } from "@/components/user-menu";
import {
  HomeIcon,
  TicketIcon,
  PlusIcon,
  UsersIcon,
  TagIcon,
  PaletteIcon,
  BookIcon,
  ClipboardIcon,
  ShieldIcon,
  SlidersIcon,
  ChartBarIcon,
  ChevronLeftIcon,
  MenuIcon,
} from "@/components/icons";

export type NavIconKey =
  | "overview"
  | "tickets"
  | "newTicket"
  | "team"
  | "categories"
  | "fields"
  | "branding"
  | "kb"
  | "audit"
  | "analytics"
  | "super";

const ICONS: Record<NavIconKey, (props: React.SVGProps<SVGSVGElement>) => React.ReactElement> = {
  overview: HomeIcon,
  tickets: TicketIcon,
  newTicket: PlusIcon,
  team: UsersIcon,
  categories: TagIcon,
  fields: SlidersIcon,
  branding: PaletteIcon,
  kb: BookIcon,
  audit: ClipboardIcon,
  analytics: ChartBarIcon,
  super: ShieldIcon,
};

export type NavLink = { href: string; label: string; icon: NavIconKey; badge?: number };

const COLLAPSE_KEY = "solvr:sidebar-collapsed";

/** Picks the most specific (longest) matching href so /admin doesn't light up for /admin/team too. */
function findActiveHref(pathname: string, links: NavLink[]): string | null {
  let best: string | null = null;
  for (const l of links) {
    const matches = pathname === l.href || pathname.startsWith(`${l.href}/`);
    if (matches && (!best || l.href.length > best.length)) best = l.href;
  }
  return best;
}

export function Sidebar({
  productName,
  logoUrl,
  links,
  userName,
  avatarUrl,
  profileHref,
  banner,
  children,
}: {
  productName: string;
  logoUrl: string | null;
  links: NavLink[];
  userName: string;
  avatarUrl: string | null;
  profileHref: string;
  banner?: React.ReactNode;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const activeHref = findActiveHref(pathname, links);
  const [collapsed, setCollapsed] = useState(false);
  const [mounted, setMounted] = useState(false);
  // Off-canvas drawer state, <768px only — sidebar is always visible (and
  // the collapse/expand affordance above is desktop-only) at md and up.
  const [mobileOpen, setMobileOpen] = useState(false);

  // Reads the persisted collapse state after mount rather than in the
  // useState initializer, on purpose: this component renders on the server
  // first (no `window`), so the initial client render must also start
  // collapsed=false to match that markup exactly, or React logs a
  // hydration mismatch. The one-frame flash this trades for is the lesser
  // issue — `mounted` suppresses the width transition so it doesn't
  // animate open on that first frame.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    setCollapsed(localStorage.getItem(COLLAPSE_KEY) === "1");
    setMounted(true);
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Closing on route change covers both "tapped a nav link" and "used the
  // back/forward buttons" without needing an onClick on every Link.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);
  /* eslint-enable react-hooks/set-state-in-effect */

  function toggleCollapsed() {
    setCollapsed((c) => {
      const next = !c;
      localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
      return next;
    });
  }

  return (
    <div className="min-h-screen app-shell-bg">
      {banner}

      {/* Mobile-only top bar — the sidebar itself is off-canvas below md. */}
      <div className="md:hidden sticky top-0 z-20 flex items-center gap-3 h-14 px-4 border-b border-black/5 dark:border-white/10 bg-[var(--color-surface)]/80 backdrop-blur-xl">
        <button
          onClick={() => setMobileOpen(true)}
          aria-label="Open menu"
          className="h-9 w-9 flex items-center justify-center rounded-lg text-[var(--color-neutral-700)] hover:bg-black/[0.045] dark:hover:bg-white/[0.08] hover:text-[var(--foreground)] transition-colors duration-150 cursor-pointer"
        >
          <MenuIcon className="h-5 w-5" />
        </button>
        {logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logoUrl} alt={productName} className="h-6 w-6 object-contain rounded" />
        ) : (
          <>
            <Image src="/brand/solvr-wordmark-black.svg" alt={productName} width={64} height={23} className="dark:hidden" />
            <Image src="/brand/solvr-wordmark-white.svg" alt={productName} width={64} height={23} className="hidden dark:block" />
          </>
        )}
      </div>

      {mobileOpen && (
        <div
          onClick={() => setMobileOpen(false)}
          aria-hidden="true"
          className="md:hidden fixed inset-0 z-30 bg-black/30 backdrop-blur-[2px] animate-[fadeIn_150ms_ease-out]"
        />
      )}

      <aside
        className={`fixed left-0 bottom-0 z-40 flex flex-col border-r border-white/50 dark:border-white/10 bg-[var(--color-surface)]/80 backdrop-blur-xl shadow-[1px_0_24px_rgba(0,0,0,0.04)] w-[248px] transition-[width,transform] duration-200 ${
          banner ? "top-9 md:top-9" : "top-0"
        } ${collapsed ? "md:w-[76px]" : "md:w-[248px]"} ${mobileOpen ? "translate-x-0" : "-translate-x-full"} md:translate-x-0 ${
          mounted ? "" : "duration-0"
        }`}
      >
        <div className={`flex items-center h-16 px-4 border-b border-black/5 dark:border-white/10 ${collapsed ? "md:justify-center md:px-0" : ""}`}>
          <Link href="/" className="flex items-center gap-2 min-w-0">
            {logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logoUrl} alt="" className="h-6 w-6 shrink-0 object-contain rounded" />
            ) : (
              <>
                <Image
                  src="/brand/solvr-wordmark-black.svg"
                  alt={productName}
                  width={72}
                  height={26}
                  className={`shrink-0 dark:hidden ${collapsed ? "md:hidden" : ""}`}
                />
                <Image
                  src="/brand/solvr-wordmark-white.svg"
                  alt={productName}
                  width={72}
                  height={26}
                  className={`shrink-0 hidden dark:block ${collapsed ? "md:hidden" : ""}`}
                />
                {collapsed && (
                  <>
                    <Image
                      src="/brand/s-mark-black.svg"
                      alt={productName}
                      width={22}
                      height={30}
                      className="hidden md:block dark:md:hidden shrink-0"
                    />
                    <Image
                      src="/brand/s-mark-white.svg"
                      alt={productName}
                      width={22}
                      height={30}
                      className="hidden dark:md:block shrink-0"
                    />
                  </>
                )}
              </>
            )}
            {logoUrl && <span className={`text-[13px] font-semibold truncate ${collapsed ? "md:hidden" : ""}`}>{productName}</span>}
          </Link>
        </div>

        <nav className="flex-1 overflow-y-auto py-3 px-3 space-y-0.5">
          {links.map((l) => {
            const Icon = ICONS[l.icon];
            const active = l.href === activeHref;
            return (
              <Link
                key={l.href}
                href={l.href}
                title={collapsed ? l.label : undefined}
                className={`group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-[13px] font-medium transition-all duration-150 cursor-pointer ${
                  collapsed ? "md:justify-center md:px-0" : ""
                } ${
                  active
                    ? "bg-[var(--color-primary)] text-white shadow-[0_4px_14px_-4px_var(--color-primary)]"
                    : "text-[var(--color-neutral-700)] hover:bg-black/[0.045] dark:hover:bg-white/[0.06] hover:text-[var(--foreground)]"
                }`}
              >
                <Icon className={`h-[18px] w-[18px] shrink-0 transition-transform duration-150 ${!active ? "group-hover:scale-110" : ""}`} />
                <span className={`truncate ${collapsed ? "md:hidden" : ""}`}>{l.label}</span>
                {l.badge !== undefined && l.badge > 0 && (
                  <span
                    aria-label={`${l.badge} pending`}
                    className={`ml-auto inline-flex items-center justify-center rounded-full text-[10px] font-semibold min-w-[18px] h-[18px] px-1.5 ${
                      active
                        ? "bg-white/25 text-white"
                        : "bg-[var(--color-primary)] text-white"
                    } ${collapsed ? "md:hidden" : ""}`}
                  >
                    {l.badge > 99 ? "99+" : l.badge}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-black/5 dark:border-white/10 px-3 py-3 space-y-1">
          <NotificationBell variant="sidebar" collapsed={collapsed} />
          <UserMenu userName={userName} avatarUrl={avatarUrl} profileHref={profileHref} variant="sidebar" collapsed={collapsed} />
        </div>

        <button
          onClick={toggleCollapsed}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="hidden md:flex absolute -right-3 top-16 h-6 w-6 rounded-full bg-[var(--color-surface)] border border-[var(--color-neutral-300)] shadow-sm items-center justify-center text-[var(--color-neutral-600)] hover:text-[var(--foreground)] hover:border-black/30 dark:hover:border-white/30 transition-colors duration-150 cursor-pointer"
        >
          <ChevronLeftIcon className={`h-3.5 w-3.5 transition-transform duration-200 ${collapsed ? "rotate-180" : ""}`} />
        </button>
      </aside>

      <div
        className={`min-h-screen transition-[margin] duration-200 ml-0 ${collapsed ? "md:ml-[76px]" : "md:ml-[248px]"}`}
      >
        {children}
      </div>
    </div>
  );
}
