// Small inline icon set (Heroicons-outline style, 20x20 viewBox, stroke-based)
// used by the sidebar nav — kept in one file so every icon shares the same
// stroke width / sizing convention.
import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

const base = {
  viewBox: "0 0 20 20",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

export function HomeIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M3 8.5 10 3l7 5.5V16a1 1 0 0 1-1 1h-3.5v-5h-5v5H4a1 1 0 0 1-1-1V8.5Z" />
    </svg>
  );
}

export function TicketIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M3 8a2 2 0 0 0 0 4v2.5A1.5 1.5 0 0 0 4.5 16h11a1.5 1.5 0 0 0 1.5-1.5V12a2 2 0 0 1 0-4V5.5A1.5 1.5 0 0 0 15.5 4h-11A1.5 1.5 0 0 0 3 5.5V8Z" />
      <path d="M8 4v12" strokeDasharray="1.6 1.6" />
    </svg>
  );
}

export function PlusIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M10 4v12M4 10h12" />
    </svg>
  );
}

export function UsersIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <circle cx="7" cy="7" r="2.5" />
      <path d="M2.5 16c0-2.5 2-4 4.5-4s4.5 1.5 4.5 4" />
      <circle cx="14" cy="8" r="2" />
      <path d="M13 12c1.9.1 3.5 1.4 3.5 4" />
    </svg>
  );
}

export function TagIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M10.5 3.5h4a1 1 0 0 1 1 1v4a1 1 0 0 1-.3.7l-7 7a1 1 0 0 1-1.4 0l-4.5-4.5a1 1 0 0 1 0-1.4l7-7a1 1 0 0 1 .7-.3Z" />
      <circle cx="13.5" cy="6.5" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function PaletteIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M10 3a7 7 0 1 0 0 14h.5a1.5 1.5 0 0 0 1.5-1.5c0-.5-.2-.9-.5-1.2-.3-.3-.5-.7-.5-1.2 0-.8.7-1.5 1.5-1.5H14a3 3 0 0 0 3-3c0-3.3-3.1-5.6-7-5.6Z" />
      <circle cx="6.5" cy="9" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="9" cy="6.5" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="12.5" cy="7.5" r="0.9" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function BookIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M4 4.5c2-1 4.7-1 6 0v11c-1.3-1-4-1-6 0v-11Z" />
      <path d="M16 4.5c-2-1-4.7-1-6 0v11c1.3-1 4-1 6 0v-11Z" />
    </svg>
  );
}

export function ClipboardIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <rect x="5" y="4" width="10" height="13" rx="1.2" />
      <path d="M7.5 4V3a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v1" />
      <path d="M7.5 9h5M7.5 12h5" />
    </svg>
  );
}

export function ShieldIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M10 2.5 16 5v5c0 4-2.5 6.5-6 7.5-3.5-1-6-3.5-6-7.5V5l6-2.5Z" />
      <path d="M7.5 10 9 11.5l3.5-3.5" />
    </svg>
  );
}

export function BellIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M15 8a5 5 0 0 0-10 0c0 5.8-2.5 7.5-2.5 7.5h15S15 13.8 15 8Z" />
      <path d="M11.4 17.5a1.7 1.7 0 0 1-2.9 0" />
    </svg>
  );
}

export function ChevronLeftIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M12.5 4.5 6.5 10l6 5.5" />
    </svg>
  );
}

export function MenuIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M3 5.5h14M3 10h14M3 14.5h14" />
    </svg>
  );
}

export function ChatIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M4 4.5h12a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H8l-3.5 3v-3H4a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1Z" />
      <path d="M7 8h6M7 10.5h4" />
    </svg>
  );
}

export function CheckCircleIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <circle cx="10" cy="10" r="7.5" />
      <path d="M6.8 10.2 9 12.3l4.2-4.6" />
    </svg>
  );
}

export function AlertCircleIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <circle cx="10" cy="10" r="7.5" />
      <path d="M10 6.5v4" />
      <circle cx="10" cy="13.2" r="0.15" fill="currentColor" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

export function InfoCircleIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <circle cx="10" cy="10" r="7.5" />
      <path d="M10 9.2v4.3" />
      <circle cx="10" cy="6.7" r="0.15" fill="currentColor" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

export function CloseIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M5 5l10 10M15 5 5 15" />
    </svg>
  );
}

export function SparklesIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M10 3.2 11.3 7 15 8.3 11.3 9.6 10 13.4 8.7 9.6 5 8.3 8.7 7 10 3.2Z" />
      <path d="M15.5 12.5 16 14l1.5.5-1.5.5L15.5 16.5 15 15l-1.5-.5L15 14l.5-1.5Z" />
    </svg>
  );
}

export function SearchIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <circle cx="8.5" cy="8.5" r="5" />
      <path d="m16 16-3.8-3.8" />
    </svg>
  );
}

export function PaperclipIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M15 8.5 9.3 14.2a2.5 2.5 0 0 1-3.5-3.5l6-6a1.7 1.7 0 0 1 2.4 2.4l-6 6a0.9 0.9 0 0 1-1.3-1.3l5.3-5.3" />
    </svg>
  );
}

export function MailIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <rect x="3" y="5" width="14" height="10" rx="1.5" />
      <path d="m3.5 6 6.5 5 6.5-5" />
    </svg>
  );
}

export function ChevronDownIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M5 7.5 10 12.5 15 7.5" />
    </svg>
  );
}

export function LinkIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M8.5 11.5a3 3 0 0 0 4.24 0l2-2a3 3 0 0 0-4.24-4.24l-1 1" />
      <path d="M11.5 8.5a3 3 0 0 0-4.24 0l-2 2a3 3 0 0 0 4.24 4.24l1-1" />
    </svg>
  );
}

export function TrashIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M4.5 6h11M8 6V4.5a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1V6" />
      <path d="M6 6l.6 9.2a1 1 0 0 0 1 .8h4.8a1 1 0 0 0 1-.8L14 6" />
      <path d="M8.5 9v4M11.5 9v4" />
    </svg>
  );
}

export function SendIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M17 3 3 9.2l5.5 1.8M17 3l-5 14-3.5-6M17 3 8.5 11" />
    </svg>
  );
}

export function BoldIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M6.5 4h4.2a2.8 2.8 0 0 1 0 5.6H6.5V4Z" />
      <path d="M6.5 9.6h4.7a3 3 0 0 1 0 6H6.5V9.6Z" />
    </svg>
  );
}

export function ItalicIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M9 4h5M6 16h5M11 4l-3 12" />
    </svg>
  );
}

export function UnderlineIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M5.5 4v5.5a4.5 4.5 0 0 0 9 0V4M4.5 16.5h11" />
    </svg>
  );
}

export function ListBulletIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <circle cx="4.5" cy="5.5" r="1" fill="currentColor" stroke="none" />
      <circle cx="4.5" cy="10" r="1" fill="currentColor" stroke="none" />
      <circle cx="4.5" cy="14.5" r="1" fill="currentColor" stroke="none" />
      <path d="M8 5.5h8M8 10h8M8 14.5h8" />
    </svg>
  );
}

export function ListOrderedIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M8 5.5h8M8 10h8M8 14.5h8" />
      <text x="2.5" y="7" fontSize="4.5" fill="currentColor" stroke="none" fontFamily="sans-serif">1</text>
      <text x="2.5" y="11.5" fontSize="4.5" fill="currentColor" stroke="none" fontFamily="sans-serif">2</text>
      <text x="2.5" y="16" fontSize="4.5" fill="currentColor" stroke="none" fontFamily="sans-serif">3</text>
    </svg>
  );
}

export function AtIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <circle cx="10" cy="10.5" r="3" />
      <path d="M13 10.5v1.3a1.7 1.7 0 0 0 3.4 0V10.5a6.4 6.4 0 1 0-2.7 5.2" />
    </svg>
  );
}

export function UserPlusIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <circle cx="8" cy="8" r="3" />
      <path d="M2.5 17c0-3 2.5-5 5.5-5s5.5 2 5.5 5" />
      <path d="M15.5 7v5M13 9.5h5" />
    </svg>
  );
}
