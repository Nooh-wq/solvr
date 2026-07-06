# Stralis Design System

Portable reference for any Stralis app (main product, marketing site, admin console, future spin-offs). Drop this file into a new repo and Claude Code / any engineer can build UI that looks native to the family without having to hunt through the original codebase.

> **Using this in another Stralis app:**
> 1. Copy this file to `docs/stralis-design-system.md` in the new repo.
> 2. Add `@docs/stralis-design-system.md` to that repo's `CLAUDE.md` so Claude Code auto-loads it every session.
> 3. Copy the token block from §2 into that repo's `globals.css` (adjust for its Tailwind version).
> 4. Copy the primitive components in §5 if the app doesn't already have them.
>
> The point: any Stralis app should be *visually indistinguishable* from the main product without any engineer having to reason about tokens or copy-paste from screenshots.

---

## 1. Philosophy

- **Small, hand-rolled, no shadcn.** Six primitive components, ~35 icons, one CSS file of tokens. If it doesn't fit in your head, it's not built yet.
- **Tokens are CSS variables, not TypeScript.** So they can be overridden at runtime per tenant (branding), and no build step is needed to change one.
- **Only *color* is tokenized.** Spacing, radius, typography, shadows all come straight from Tailwind's defaults. Don't invent a `--spacing-md`.
- **Class-based dark mode**, not `prefers-color-scheme` at the CSS level. `next-themes` toggles `.dark` on `<html>` so in-app Light/Dark/System choices always win over OS.
- **Tenant-brandable at runtime.** Three tokens (`--color-primary`, `--color-primary-hover`, `--color-accent`) can be rewritten by a tenant's branding record. Everything else is fixed.
- **Sentence case in labels**, not Title Case. Buttons say "Send invite", not "Send Invite".
- **No emojis as UI.** SVG icons only. Emojis in copy are fine.

---

## 2. Design tokens

All tokens are CSS variables in `src/app/globals.css`. There is no `tokens.ts` — do not create one.

### Tailwind version
The main app is on **Tailwind v4** and uses `@theme inline { ... }` in CSS instead of `tailwind.config.js`. If your new app is still on v3, translate `@theme` entries into the config's `theme.extend.colors`.

### Full token block (copy this into new apps' `globals.css`)

```css
@import "tailwindcss";

/* Class-based dark mode — next-themes toggles `.dark` on <html>. */
@custom-variant dark (&:where(.dark, .dark *));

:root {
  /* Stralis brand palette */
  --color-black: #000000;
  --color-white: #ffffff;
  --color-mid-gray: #aeaeae;
  --color-light-gray: #ebebeb;
  --color-orange: #ff6a00;

  /* Orange tonal ramp */
  --color-orange-wash: #291100;
  --color-orange-deep: #cc5500;
  --color-orange-core: #ff6a00;
  --color-orange-bright: #ff8f40;
  --color-orange-pale: #fff2e8;

  /* Neutral ramp (light) */
  --color-neutral-900: #1a1a1a;
  --color-neutral-700: #333333;
  --color-neutral-600: #4c4c4c;
  --color-neutral-500: #7a7a7a;
  --color-neutral-400: #aeaeae;
  --color-neutral-300: #cccccc;
  --color-neutral-200: #dedede;
  --color-neutral-100: #ebebeb;

  /* Card/panel surface — sits on top of --background. */
  --color-surface: #ffffff;

  /* Tenant-overridable — TenantBranding rewrites these three at runtime */
  --color-primary: var(--color-orange);
  --color-primary-hover: var(--color-orange-deep);
  --color-accent: var(--color-black);

  --background: #ffffff;
  --foreground: #000000;
}

.dark {
  --color-mid-gray: #6b6b6b;
  --color-light-gray: #1e2024;
  --color-orange-pale: #2b1c10;

  --color-neutral-900: #f5f5f5;
  --color-neutral-700: #d4d4d4;
  --color-neutral-600: #a3a3a3;
  --color-neutral-500: #8a8a8a;
  --color-neutral-400: #6b6b6b;
  --color-neutral-300: #33353a;
  --color-neutral-200: #2b2d31;
  --color-neutral-100: #232529;

  --color-surface: #1a1b1e;

  --background: #121212;
  --foreground: #f2f2f2;

  /* Note: --color-primary / --color-accent stay unchanged in dark mode —
     a tenant brand color reads fine on both surfaces, so only the
     structural palette inverts. */
}

@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-primary: var(--color-primary);
  --color-primary-hover: var(--color-primary-hover);
  --color-accent: var(--color-accent);
  --color-orange: var(--color-orange);
  --color-orange-wash: var(--color-orange-wash);
  --color-orange-deep: var(--color-orange-deep);
  --color-orange-core: var(--color-orange-core);
  --color-orange-bright: var(--color-orange-bright);
  --color-orange-pale: var(--color-orange-pale);
  --color-neutral-900: var(--color-neutral-900);
  --color-neutral-700: var(--color-neutral-700);
  --color-neutral-600: var(--color-neutral-600);
  --color-neutral-500: var(--color-neutral-500);
  --color-neutral-400: var(--color-neutral-400);
  --color-neutral-300: var(--color-neutral-300);
  --color-neutral-200: var(--color-neutral-200);
  --color-neutral-100: var(--color-neutral-100);
  --color-surface: var(--color-surface);
  --font-sans: var(--font-geist-sans);
  --font-mono: var(--font-geist-mono);
}

body {
  background: var(--background);
  color: var(--foreground);
  font-family: var(--font-sans), Arial, Helvetica, sans-serif;
}
```

### How to reference tokens in components

Prefer the CSS-variable form since it's what the whole codebase uses:

```tsx
<div className="bg-[var(--color-surface)] text-[var(--foreground)] border border-[var(--color-neutral-300)]">
```

Avoid `bg-white`, `text-black`, `border-gray-200` — they don't respect dark mode or tenant branding.

### The one exception where hardcoded hex is fine

For decorative overlays with opacity (e.g. hover states, glass effects), use `rgb(255 255 255 / 0.08)` — computed with a channel value rather than a token — because CSS variables can't be composed into `rgba()` without `color-mix` gymnastics. This is the only place hex should appear.

---

## 3. Dark mode

Class-driven via `next-themes`. Install:

```bash
npm install next-themes
```

`src/components/theme-provider.tsx`:
```tsx
"use client";
import { ThemeProvider as NextThemesProvider } from "next-themes";

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider attribute="class" defaultTheme="system" enableSystem>
      {children}
    </NextThemesProvider>
  );
}
```

Wrap `<html>` in the root layout:
```tsx
<html lang="en" suppressHydrationWarning>
  <body><ThemeProvider>{children}</ThemeProvider></body>
</html>
```

**Rule:** if you write `bg-white`, you're doing it wrong. Use `bg-[var(--color-surface)]`.

**Rule:** if you interpolate between two hardcoded hex colors (`from-white to-gray-100`), invisible-in-dark-mode bugs will happen. Use opacity over one CSS variable (e.g. `bg-[var(--color-primary)] opacity-30`).

---

## 4. Typography

No custom scale. Use Tailwind defaults:
- Body: `text-sm` (14px) or `text-[13px]` for dense UIs
- Headings: `text-2xl font-bold` for page titles, `text-[13px] font-semibold` for card titles
- Labels: uppercase 11px — use the `.uppercase-label` utility class + `text-[11px] font-semibold text-[var(--color-neutral-700)]`
- Mono: `font-mono tabular-nums` for numeric columns (analytics tables, agent leaderboard)

Fonts come from Geist (`--font-geist-sans`, `--font-geist-mono`) — set in root layout via `next/font/local` or the geist package.

---

## 5. Component primitives

All six live in `src/components/ui/`. Copy the ones you need into new apps.

### `Button`

```tsx
import { Button } from "@/components/ui/button";

<Button>Primary</Button>
<Button variant="secondary">Secondary</Button>
<Button variant="ghost">Ghost</Button>
<Button variant="danger">Danger</Button>
<Button size="sm">Small</Button>
```

**Signature:** `variant?: "primary" | "secondary" | "ghost" | "danger"`, `size?: "sm" | "md"` (defaults `primary` + `md`), plus every `<button>` attribute.

**Key details:**
- Radius: `rounded-full` (fully pill).
- Primary button has a soft orange glow shadow that intensifies on hover, plus a 1px lift (`-translate-y-px`).
- Every button has `cursor-pointer`, `active:scale-[0.97]` for tactile feedback, and `disabled:opacity-40 disabled:pointer-events-none`.
- `whitespace-nowrap` so button labels never wrap.

### `Input`, `Textarea`, `Select`, `Label`

```tsx
import { Input, Textarea, Select, Label } from "@/components/ui/input";

<div className="space-y-1.5">
  <Label htmlFor="email">Email</Label>
  <Input id="email" name="email" type="email" required />
</div>

<Select defaultValue="AGENT">
  <option value="CLIENT">Client</option>
  <option value="AGENT">Agent</option>
</Select>
```

**Key details:**
- Height: `h-10` (Input, Select). Textarea flexible.
- Radius: `rounded-xl`.
- Border: `border-[var(--color-neutral-300)]`, focus goes to `border-[var(--foreground)]` (no ring — the border darkens instead).
- Label is uppercase 11px semibold with the `.uppercase-label` utility for letter spacing.

### `Modal`

```tsx
import { Modal } from "@/components/ui/modal";

<Modal open={open} onClose={() => setOpen(false)} title="Delete this person?">
  <p>...</p>
  <div className="flex justify-end gap-2">
    <Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
    <Button variant="danger" onClick={confirmDelete}>Delete</Button>
  </div>
</Modal>
```

**Key details:**
- Portal-mounted, backdrop with blur.
- Closes on backdrop click + Escape.
- No focus trap yet (backlog item — if you need it, wire it up with `react-aria` or roll a small `useFocusTrap`).

### `Toast` + `useToast`

Toasts are provider-based. Wrap your app once, then call `toast()` from anywhere.

```tsx
// app/layout.tsx
import { ToastProvider } from "@/components/ui/toast";
<ToastProvider>{children}</ToastProvider>

// anywhere
import { useToast } from "@/components/ui/toast";
const { toast } = useToast();
toast({ title: "Saved", description: "…", variant: "success" });
```

**Signature:** `{ title, description?, variant?: "info" | "success" | "error" }`. Auto-dismisses after ~4s.

### `Avatar`

```tsx
import { Avatar } from "@/components/ui/avatar";

<Avatar name="Muhammad Nooh" seed={user.id} size="md" />
<Avatar name={user.name} avatarUrl={user.avatarUrl} size="lg" />
```

**Key details:**
- Deterministic color from a 9-color palette (orange/blue/emerald/purple/pink/amber/teal/red/indigo), keyed by `seed` if provided otherwise `name`.
- Initials from first char of the first two words.
- Sizes: `sm` (h-7), `md` (h-9, default), `lg` (h-11).
- `avatarUrl` wins over initials if provided.

---

## 6. Domain-specific badges (not in `ui/`)

These are colocated with their features because they encode business meaning, not generic pill styling. Don't move them into `ui/`. Copy the pattern when building a new domain badge.

- **`StatusBadge` / `PriorityLabel`** (in `src/components/ui/badge.tsx` in this repo — arguably misplaced; treat as ticket-specific): renders ticket status/priority with the app's status color language.
- **`RoleBadge`** (in `src/app/(admin)/admin/team/role-badge.tsx`): Super Admin / Admin / Agent / Client, colored pills with muted backgrounds.
- **`StatusIndicator`** (same folder): colored dot + label per user status (Active/Pending approval/Invited/Deactivated/Rejected/Unverified).

Follow the same visual language when adding a new one:

```tsx
// Pill: bg-*/10 + text-*-700 + ring-1 ring-*/20 for all pill badges
"inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium ring-1 ring-inset"

// Dot indicator: bg-*-500 dot + text-*-700/300 label
"inline-flex items-center gap-1.5 text-[12px] font-medium"
```

Colors for common meanings (already used across the app):
- Success / active → `emerald` (500 for solid, 700 light-mode / 300 dark-mode for text)
- Info / invited → `blue`
- Warning / pending → `amber`
- Danger / rejected → `red`
- Brand / super-admin → `var(--color-primary)`
- Muted / deactivated → `var(--color-neutral-400)`

---

## 7. Icons

- **One file:** `src/components/icons.tsx` — every icon is an inline SVG.
- **Style:** Heroicons-outline, `viewBox="0 0 20 20"`, `stroke="currentColor"`, `strokeWidth={1.6}`, round line caps/joins.
- **Sizing:** default via className, usually `h-4 w-4` for inline UI, `h-[18px] w-[18px]` for nav.
- **Adding a new icon:**

```tsx
export function MyIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="..." />
    </svg>
  );
}
```

Where `base` is the shared `{ viewBox, fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round", strokeLinejoin: "round" }` object at the top of the file. Follow the convention — don't pull from a library, don't mix stroke widths.

**Rule:** never use emojis as icons. Always SVG.

---

## 8. Layout patterns

### The app shell (sidebar + main)

Every logged-in surface (portal, agent, admin) uses the same shell:
- Left: fixed `<Sidebar>` (248px expanded, 76px collapsed) with the tenant logo, nav links, notification bell, user menu.
- Main: `<main className="mx-auto max-w-screen-2xl px-6 py-8">`.
- Background: the `.app-shell-bg` utility class — light-gray base with two soft radial glows in the brand primary/accent.

### Cards

The standard content card:
```tsx
<div className="bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl p-5">
  <h2 className="text-[13px] font-semibold mb-4">Card title</h2>
  ...
</div>
```

Radius is always `rounded-2xl` on cards. Padding is `p-5` for most, `p-8` for auth-form panels.

### Tables

Header row: `bg-[var(--color-light-gray)]` + uppercase 11px labels. Body rows: `border-t border-[var(--color-neutral-100)]` between rows. Numeric columns use `font-mono tabular-nums`.

### Modals + popovers

Fade-in animation: use the pre-defined `animate-[fadeIn_120ms_ease-out]` (fadeIn keyframe is in globals.css). Shadow: `shadow-[0_8px_28px_-8px_rgba(0,0,0,0.16)]`.

### The auth screen

Two-column split: left side is the theme-aware form panel, right side is `.auth-showcase-bg` (fixed-dark `#0b0b0d` background) regardless of theme — showcases the brand consistently before the user has a theme preference. Copy this pattern for any public marketing/signup screen.

### Glass panel utility

`.glass-panel` = translucent surface + backdrop blur. Used on the auth form panel and dropdown menus:

```css
.glass-panel {
  background-color: rgb(255 255 255 / 0.82);
  backdrop-filter: blur(20px);
  border: 1px solid rgb(255 255 255 / 0.6);
}
.dark .glass-panel {
  background-color: rgb(26 27 30 / 0.75);
  border: 1px solid rgb(255 255 255 / 0.08);
}
```

---

## 9. Motion & animation

- **Micro-interactions:** 150ms with `ease-out`. Hover on Button = 150ms, dropdown fade-in = 120ms, tab-switch pill slide = 200ms.
- **Avoid layout shift on hover.** Don't use `scale-105` on cards — use `-translate-y-px` (Button does this) or a color/shadow change.
- **Reduced-motion:** the global CSS already collapses all animations to 0.01ms when `prefers-reduced-motion: reduce`. Don't add motion that ignores this.

---

## 10. What NOT to do (common footguns from real bug fixes)

1. **`bg-white` / `text-black` / `border-gray-200`** — breaks dark mode. Use tokens.
2. **Interpolating between two hardcoded hex colors** (`linear-gradient(#fff, #000)`) — invisible in dark mode. Use opacity over one CSS variable.
3. **Scale-on-hover for cards/tiles** — causes neighboring rows to shift. Use translate or shadow instead.
4. **Emojis as icons** — always SVG. If the icon doesn't exist yet, add it to `icons.tsx`.
5. **`inline-grid` when you want a grid to fill its parent** — inline-grid sizes to min content. Use `grid` + `minmax(0, 1fr)` columns.
6. **Bare `1fr` grid columns at narrow viewports** — grid tracks have implicit `min-width: auto` from content, so `1fr` can still overflow. `minmax(0, 1fr)` fixes it.
7. **`fill="black"` on an SVG icon** — bakes light-mode into the icon. Always `fill="currentColor"` (or `fill="none"` for outline icons) so `text-*` classes control it.
8. **Custom spacing / radius tokens** — don't invent `--spacing-md`. Use Tailwind's scale.
9. **Custom shadow tokens** — same. Use Tailwind's `shadow-*` or inline `shadow-[...]`.
10. **Forgetting `cursor-pointer`** on non-`<button>` clickable elements. Every interactive element must show a pointer cursor.

---

## 11. Extending the system

**Before adding a primitive**, ask:
1. Does an existing primitive cover it with a prop? (Add a variant instead of a new component.)
2. Is it truly generic, or does it encode domain semantics? (Domain badges live with their feature, not in `ui/`.)
3. Would three unrelated features use it? (If only one uses it, colocate it with that feature.)

**When adding a new token color**, ask:
1. Is a Tailwind default color close enough? (Use `emerald-500` etc. before adding a new token.)
2. Is it tenant-brandable or fixed? (Only three tokens should be tenant-overridable: primary, primary-hover, accent. Everything else is fixed.)
3. Will it read in dark mode? (Add a `.dark` override in the same commit.)

**When adding a new icon**, follow the strict `base` convention in `icons.tsx`. Don't paste in an SVG from Figma with its own stroke width / viewBox / fill — reshape it to match.

---

## 12. Reference file locations (for THIS repo)

If you're working in the main Stralis Ticketing System repo (not a new app), the source of truth is:

- Tokens: [`src/app/globals.css`](../src/app/globals.css)
- Primitives: [`src/components/ui/`](../src/components/ui)
- Icons: [`src/components/icons.tsx`](../src/components/icons.tsx)
- Shell: [`src/components/sidebar.tsx`](../src/components/sidebar.tsx)
- Tenant branding CSS-var override: `brandingToCssVars()` in [`src/lib/tenant.ts`](../src/lib/tenant.ts)

For a new Stralis app, treat this markdown as the authoritative reference until the new app builds up its own component library.
