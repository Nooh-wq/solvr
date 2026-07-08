"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { NotificationBell } from "@/components/notification-bell";
import { UserMenu } from "@/components/user-menu";
import { AdminSearch } from "@/components/admin-search";
import {
  HomeIcon,
  TicketIcon,
  PlusIcon,
  UsersIcon,
  UserIcon,
  BuildingIcon,
  HeadsetIcon,
  GroupsIcon,
  UserMinusIcon,
  DocumentIcon,
  TagIcon,
  PaletteIcon,
  BookIcon,
  ClipboardIcon,
  ShieldIcon,
  SlidersIcon,
  ChartBarIcon,
  ChevronLeftIcon,
  ChevronDownIcon,
  MenuIcon,
  StarIcon,
} from "@/components/icons";

// Every nav row needs a visually distinct glyph so collapsed-mode users
// can still recognize each surface.
export type NavIconKey =
  | "overview"
  | "tickets"
  | "newTicket"
  | "customers"
  | "organizations"
  | "teamMembers"
  | "groups"
  | "team"
  | "categories"
  | "fields"
  | "forms"
  | "branding"
  | "kb"
  | "audit"
  | "deletions"
  | "analytics"
  | "shield"
  | "super";

const ICONS: Record<NavIconKey, (props: React.SVGProps<SVGSVGElement>) => React.ReactElement> = {
  overview: HomeIcon,
  tickets: TicketIcon,
  newTicket: PlusIcon,
  customers: UserIcon,
  organizations: BuildingIcon,
  teamMembers: HeadsetIcon,
  groups: GroupsIcon,
  team: UsersIcon,
  categories: TagIcon,
  fields: SlidersIcon,
  forms: ClipboardIcon,
  branding: PaletteIcon,
  kb: BookIcon,
  audit: DocumentIcon,
  deletions: UserMinusIcon,
  analytics: ChartBarIcon,
  shield: ShieldIcon,
  super: ShieldIcon,
};

export type NavLink = { href: string; label: string; icon: NavIconKey; badge?: number };

/**
 * Z7 — grouped admin nav. Each section header is a link to its landing
 * page and a collapse toggle in one row (chevron button on the right).
 * Collapse state persists per-user in localStorage.
 */
export type NavSection = {
  slug: string;
  label: string;
  links: NavLink[];
};

const COLLAPSE_KEY = "solvr:sidebar-collapsed";
const SECTIONS_KEY = "solvr:admin-sections-open";
const RECENT_KEY = "solvr:admin-recently-viewed";
const RECENT_MAX = 5;

/** Picks the most specific (longest) matching href so /admin doesn't light up for /admin/team too. */
function findActiveHref(pathname: string, links: NavLink[]): string | null {
  let best: string | null = null;
  for (const l of links) {
    const matches = pathname === l.href || pathname.startsWith(`${l.href}/`);
    if (matches && (!best || l.href.length > best.length)) best = l.href;
  }
  return best;
}

function flattenLinks(top: NavLink[], sections: NavSection[], footer: NavLink[]): NavLink[] {
  return [...top, ...sections.flatMap((s) => s.links), ...footer];
}

/** Z7.2 — client-side visit tracker. localStorage only, no server round-trip. */
function useRecentTracker(pathname: string, allLinks: NavLink[]) {
  const [recent, setRecent] = useState<NavLink[]>([]);
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    try {
      const raw = localStorage.getItem(RECENT_KEY);
      if (raw) setRecent(JSON.parse(raw));
    } catch {
      // Corrupt entry — ignore.
    }
  }, []);
  useEffect(() => {
    const match = allLinks.find((l) => pathname === l.href || pathname.startsWith(`${l.href}/`));
    if (!match) return;
    if (match.href === "/admin" || match.href === "/admin/analytics" || match.href === "/agent") return;
    setRecent((prev) => {
      const next = [match, ...prev.filter((r) => r.href !== match.href)].slice(0, RECENT_MAX);
      try {
        localStorage.setItem(RECENT_KEY, JSON.stringify(next));
      } catch {
        // Storage full or blocked — non-fatal.
      }
      return next;
    });
  }, [pathname, allLinks]);
  /* eslint-enable react-hooks/set-state-in-effect */
  return recent;
}

function NavRow({
  link,
  activeHref,
  collapsed,
  indent,
}: {
  link: NavLink;
  activeHref: string | null;
  collapsed: boolean;
  indent?: boolean;
}) {
  const Icon = ICONS[link.icon];
  const active = link.href === activeHref;
  return (
    <Link
      href={link.href}
      title={collapsed ? link.label : undefined}
      className={`group relative flex items-center gap-3 rounded-xl px-3 py-2 text-[13px] font-medium transition-all duration-150 cursor-pointer ${
        collapsed ? "md:justify-center md:px-0" : indent ? "md:pl-6" : ""
      } ${
        active
          ? "bg-[var(--color-primary)] text-white shadow-[0_4px_14px_-4px_var(--color-primary)]"
          : "text-[var(--color-neutral-700)] hover:bg-black/[0.045] dark:hover:bg-white/[0.06] hover:text-[var(--foreground)]"
      }`}
    >
      <Icon className={`h-[18px] w-[18px] shrink-0 transition-transform duration-150 ${!active ? "group-hover:scale-110" : ""}`} />
      <span className={`truncate ${collapsed ? "md:hidden" : ""}`}>{link.label}</span>
      {link.badge !== undefined && link.badge > 0 && (
        <span
          aria-label={`${link.badge} pending`}
          className={`ml-auto inline-flex items-center justify-center rounded-full text-[10px] font-semibold min-w-[18px] h-[18px] px-1.5 ${
            active ? "bg-white/25 text-white" : "bg-[var(--color-primary)] text-white"
          } ${collapsed ? "md:hidden" : ""}`}
        >
          {link.badge > 99 ? "99+" : link.badge}
        </span>
      )}
    </Link>
  );
}

export function Sidebar({
  productName,
  logoUrl,
  links,
  sections,
  footer,
  showAdminSearch,
  userName,
  avatarUrl,
  profileHref,
  banner,
  children,
}: {
  productName: string;
  logoUrl: string | null;
  links: NavLink[];
  sections?: NavSection[];
  footer?: NavLink[];
  showAdminSearch?: boolean;
  userName: string;
  avatarUrl: string | null;
  profileHref: string;
  banner?: React.ReactNode;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const allLinks = useMemo(
    () => flattenLinks(links, sections ?? [], footer ?? []),
    [links, sections, footer]
  );
  const activeHref = findActiveHref(pathname, allLinks);
  const [collapsed, setCollapsed] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({});
  const recent = useRecentTracker(pathname, allLinks);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    setCollapsed(localStorage.getItem(COLLAPSE_KEY) === "1");
    try {
      const raw = localStorage.getItem(SECTIONS_KEY);
      if (raw) setOpenSections(JSON.parse(raw));
    } catch {
      // Ignore corrupt entry.
    }
    setMounted(true);
  }, []);

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

  function toggleSection(slug: string) {
    setOpenSections((prev) => {
      const next = { ...prev, [slug]: !isSectionOpen(slug, prev) };
      try {
        localStorage.setItem(SECTIONS_KEY, JSON.stringify(next));
      } catch {
        // Non-fatal.
      }
      return next;
    });
  }

  function isSectionOpen(slug: string, state: Record<string, boolean>): boolean {
    // Sections default to open before the user has expressed a preference,
    // and any section containing the active route stays open regardless of
    // the persisted flag — otherwise the user could land on a page whose
    // parent section is collapsed, with no visual cue for where they are.
    if (slug in state) return state[slug];
    return true;
  }

  const sectionOpen = (slug: string, hasActive: boolean) => hasActive || isSectionOpen(slug, openSections);

  return (
    <div className="min-h-screen app-shell-bg">
      {banner}

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
                <span className="md:hidden">
                  <Image src="/brand/solvr-wordmark-black.svg" alt={productName} width={72} height={26} className="shrink-0 dark:hidden" />
                  <Image src="/brand/solvr-wordmark-white.svg" alt={productName} width={72} height={26} className="shrink-0 hidden dark:block" />
                </span>
                <span className="hidden md:inline-flex items-center">
                  {collapsed ? (
                    <>
                      <Image src="/brand/s-mark-black.svg" alt={productName} width={22} height={30} className="shrink-0 dark:hidden" />
                      <Image src="/brand/s-mark-white.svg" alt={productName} width={22} height={30} className="shrink-0 hidden dark:block" />
                    </>
                  ) : (
                    <>
                      <Image src="/brand/solvr-wordmark-black.svg" alt={productName} width={72} height={26} className="shrink-0 dark:hidden" />
                      <Image src="/brand/solvr-wordmark-white.svg" alt={productName} width={72} height={26} className="shrink-0 hidden dark:block" />
                    </>
                  )}
                </span>
              </>
            )}
            {logoUrl && <span className={`text-[13px] font-semibold truncate ${collapsed ? "md:hidden" : ""}`}>{productName}</span>}
          </Link>
        </div>

        {showAdminSearch && !collapsed && (
          <div className="px-3 pt-3">
            <AdminSearch />
          </div>
        )}

        <nav className="thin-scrollbar flex-1 overflow-y-auto py-3 px-3 space-y-0.5">
          {/* Top-level links — Overview, Analytics, Queue. */}
          {links.map((l) => (
            <NavRow key={l.href} link={l} activeHref={activeHref} collapsed={collapsed} />
          ))}

          {/* Recently viewed — Z7.2. Skipped when collapsed to keep the
              rail readable. */}
          {recent.length > 0 && !collapsed && (
            <div className="pt-3">
              <div className="flex items-center gap-1.5 px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-neutral-500)]">
                <StarIcon className="h-3 w-3" />
                Recently viewed
              </div>
              {recent.map((r) => (
                <NavRow key={`recent-${r.href}`} link={r} activeHref={activeHref} collapsed={collapsed} indent />
              ))}
            </div>
          )}

          {sections && sections.length > 0 && (
            <div className="pt-3 space-y-1">
              {sections.map((s) => {
                const hasActive = s.links.some(
                  (l) => pathname === l.href || pathname.startsWith(`${l.href}/`)
                );
                const open = sectionOpen(s.slug, hasActive);
                if (collapsed) {
                  // In collapsed mode we skip section headers entirely —
                  // just render each row inline so icons stack cleanly.
                  return (
                    <div key={s.slug} className="space-y-0.5">
                      {s.links.map((l) => (
                        <NavRow key={l.href} link={l} activeHref={activeHref} collapsed={collapsed} />
                      ))}
                    </div>
                  );
                }
                return (
                  <div key={s.slug}>
                    <div className="flex items-center pr-1">
                      <Link
                        href={`/admin/section/${s.slug}`}
                        className="flex-1 truncate px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-neutral-500)] hover:text-[var(--foreground)] transition-colors duration-150"
                      >
                        {s.label}
                      </Link>
                      <button
                        onClick={() => toggleSection(s.slug)}
                        aria-label={open ? `Collapse ${s.label}` : `Expand ${s.label}`}
                        className="h-6 w-6 flex items-center justify-center rounded-md text-[var(--color-neutral-500)] hover:bg-black/[0.045] dark:hover:bg-white/[0.06] hover:text-[var(--foreground)] transition-colors duration-150 cursor-pointer"
                      >
                        <ChevronDownIcon
                          className={`h-3.5 w-3.5 transition-transform duration-150 ${open ? "" : "-rotate-90"}`}
                        />
                      </button>
                    </div>
                    {open && (
                      <div className="space-y-0.5 pt-0.5">
                        {s.links.map((l) => (
                          <NavRow key={l.href} link={l} activeHref={activeHref} collapsed={collapsed} indent />
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {footer && footer.length > 0 && (
            <div className="pt-3 space-y-0.5">
              {footer.map((l) => (
                <NavRow key={l.href} link={l} activeHref={activeHref} collapsed={collapsed} />
              ))}
            </div>
          )}
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

      <div className={`min-h-screen transition-[margin] duration-200 ml-0 ${collapsed ? "md:ml-[76px]" : "md:ml-[248px]"}`}>
        {children}
      </div>
    </div>
  );
}
