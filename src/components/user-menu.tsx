"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { logout } from "@/actions/auth";

function Avatar({ name, avatarUrl, size = 6 }: { name: string; avatarUrl: string | null; size?: number }) {
  const dim = size === 8 ? "h-8 w-8 text-[12px]" : "h-6 w-6 text-[10px]";
  if (avatarUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={avatarUrl} alt="" className={`${dim} rounded-full object-cover shrink-0`} />;
  }
  const initials = name
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  return (
    <span className={`${dim} rounded-full bg-[var(--color-neutral-300)] font-semibold text-black flex items-center justify-center shrink-0`}>
      {initials}
    </span>
  );
}

export function UserMenu({
  userName,
  avatarUrl,
  profileHref,
  variant = "topbar",
  collapsed = false,
}: {
  userName: string;
  avatarUrl: string | null;
  profileHref: string;
  variant?: "topbar" | "sidebar";
  collapsed?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  const isSidebar = variant === "sidebar";

  const menu = open && (
    <div
      className={`${
        isSidebar ? "absolute left-full bottom-0 ml-2" : "absolute right-0 mt-2"
      } w-44 bg-white/85 backdrop-blur-xl border border-white/60 rounded-2xl shadow-[0_16px_48px_-12px_rgba(0,0,0,0.25)] z-50 py-1.5 overflow-hidden animate-[fadeIn_150ms_ease-out]`}
    >
      <Link
        href={profileHref}
        onClick={() => setOpen(false)}
        className="block px-3.5 py-2 text-[13px] text-black hover:bg-black/[0.045] transition-colors duration-150 cursor-pointer"
      >
        Profile
      </Link>
      <form action={logout}>
        <button
          type="submit"
          className="block w-full text-left px-3.5 py-2 text-[13px] text-black hover:bg-black/[0.045] transition-colors duration-150 cursor-pointer"
        >
          Log out
        </button>
      </form>
    </div>
  );

  if (isSidebar) {
    return (
      <div className="relative" ref={containerRef}>
        <button
          onClick={() => setOpen((o) => !o)}
          className={`flex items-center gap-3 w-full rounded-xl px-3 py-2 text-[13px] font-medium text-[var(--color-neutral-700)] hover:bg-black/[0.045] hover:text-black transition-all duration-150 cursor-pointer ${
            collapsed ? "justify-center px-0" : ""
          }`}
        >
          <Avatar name={userName} avatarUrl={avatarUrl} size={8} />
          {!collapsed && <span className="truncate">{userName}</span>}
        </button>
        {menu}
      </div>
    );
  }

  return (
    <div className="relative" ref={containerRef}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 text-[13px] text-[var(--color-neutral-600)] hover:text-black px-2 py-1 rounded-lg transition-colors duration-150 cursor-pointer"
      >
        <Avatar name={userName} avatarUrl={avatarUrl} />
        {userName}
      </button>
      {menu}
    </div>
  );
}
