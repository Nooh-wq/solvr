import Image from "next/image";

// Small palette of pleasant color pairs. Chosen so each looks fine on both
// light and dark surfaces (light backgrounds with a mid-tone text) — same
// dark-mode-safe pattern used elsewhere in the app.
const PALETTE = [
  { bg: "bg-orange-100 dark:bg-orange-500/25", text: "text-orange-700 dark:text-orange-300" },
  { bg: "bg-blue-100 dark:bg-blue-500/25", text: "text-blue-700 dark:text-blue-300" },
  { bg: "bg-emerald-100 dark:bg-emerald-500/25", text: "text-emerald-700 dark:text-emerald-300" },
  { bg: "bg-purple-100 dark:bg-purple-500/25", text: "text-purple-700 dark:text-purple-300" },
  { bg: "bg-pink-100 dark:bg-pink-500/25", text: "text-pink-700 dark:text-pink-300" },
  { bg: "bg-amber-100 dark:bg-amber-500/25", text: "text-amber-700 dark:text-amber-300" },
  { bg: "bg-teal-100 dark:bg-teal-500/25", text: "text-teal-700 dark:text-teal-300" },
  { bg: "bg-red-100 dark:bg-red-500/25", text: "text-red-700 dark:text-red-300" },
  { bg: "bg-indigo-100 dark:bg-indigo-500/25", text: "text-indigo-700 dark:text-indigo-300" },
];

function hashSeed(seed: string): number {
  // djb2 — cheap deterministic hash. Only used to bucket into the palette
  // so exact distribution doesn't matter, just stability across renders.
  let h = 5381;
  for (let i = 0; i < seed.length; i++) h = ((h << 5) + h + seed.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

type Size = "sm" | "md" | "lg";

const SIZE_STYLES: Record<Size, { box: string; text: string; imgPx: number }> = {
  sm: { box: "h-7 w-7", text: "text-[10px]", imgPx: 28 },
  md: { box: "h-9 w-9", text: "text-[12px]", imgPx: 36 },
  lg: { box: "h-11 w-11", text: "text-[14px]", imgPx: 44 },
};

export function Avatar({
  name,
  seed,
  avatarUrl = null,
  size = "md",
}: {
  name: string;
  // Optional stable seed for color selection (e.g. user id) so the color
  // stays the same if the name changes. Falls back to the name.
  seed?: string;
  avatarUrl?: string | null;
  size?: Size;
}) {
  const s = SIZE_STYLES[size];
  if (avatarUrl) {
    return (
      <Image
        src={avatarUrl}
        alt=""
        width={s.imgPx}
        height={s.imgPx}
        className={`${s.box} rounded-full object-cover shrink-0`}
      />
    );
  }
  const palette = PALETTE[hashSeed(seed ?? name) % PALETTE.length];
  return (
    <span
      aria-hidden="true"
      className={`${s.box} ${palette.bg} ${palette.text} ${s.text} rounded-full font-semibold flex items-center justify-center shrink-0`}
    >
      {initialsOf(name) || "?"}
    </span>
  );
}
