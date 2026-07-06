"use client";

// Lightweight, dependency-free SVG charts for the admin Overview, styled to
// the Solvr palette. TrendChart needs hover state for its tooltip, so the
// whole module is a client component — Donut/BarList stay simple markup but
// render fine from a server component either way. Kept intentionally small —
// if charting needs grow (zoom, live updates, legends toggling) swap these
// for a real lib.

import { useRef, useState } from "react";

type TrendPoint = { date: string; created: number; resolved: number; net: number };

type TrendSeries = "created" | "resolved" | "net";

const SERIES_META: Record<TrendSeries, { label: string; color: string }> = {
  created: { label: "Created", color: "var(--color-primary)" },
  resolved: { label: "Resolved", color: "var(--color-neutral-700)" },
  // Net can go negative (more resolved than created that day) — kept off by
  // default so the common view renders exactly like the simple two-series
  // chart this component started as.
  net: { label: "Net", color: "var(--color-neutral-400)" },
};

/**
 * Three-series (created / resolved / net) area/line chart over a window,
 * with a clickable legend to toggle each series. Fixed viewBox + w-full
 * makes it responsive without distortion. Hovering anywhere over the chart
 * snaps a tooltip to the nearest day, showing the visible series' values in
 * a floating box instead of relying on the native browser title tooltip
 * (slow to appear, easy to miss).
 */
export function TrendChart({ data }: { data: TrendPoint[] }) {
  const W = 720;
  const H = 240;
  const padL = 32;
  const padR = 12;
  const padT = 16;
  const padB = 28;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;

  const containerRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [visible, setVisible] = useState<Set<TrendSeries>>(new Set(["created", "resolved"]));

  function toggleSeries(s: TrendSeries) {
    setVisible((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      // Never let it go fully empty — toggling the last visible series back off is a no-op.
      return next.size === 0 ? prev : next;
    });
  }

  const showNet = visible.has("net");
  const relevantValues = data.flatMap((d) => [
    ...(visible.has("created") ? [d.created] : []),
    ...(visible.has("resolved") ? [d.resolved] : []),
    ...(showNet ? [Math.abs(d.net)] : []),
  ]);
  const maxVal = Math.max(1, ...relevantValues);
  // "Nice" y-axis top rounded up so gridlines land on round numbers. When
  // `net` is visible the domain is symmetric around zero so its negative
  // values have somewhere to go; otherwise it's the plain 0..max domain the
  // chart has always used.
  const niceMax = niceCeil(maxVal);
  const domainMin = showNet ? -niceMax : 0;
  const domainMax = niceMax;
  const domainRange = domainMax - domainMin;
  const n = data.length;

  const x = (i: number) => padL + (n <= 1 ? innerW / 2 : (i / (n - 1)) * innerW);
  const y = (v: number) => padT + innerH - ((v - domainMin) / domainRange) * innerH;

  const lineFor = (key: "created" | "resolved" | "net") =>
    data.map((d, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(d[key]).toFixed(1)}`).join(" ");
  const createdLine = lineFor("created");
  const createdArea = `${createdLine} L${x(n - 1).toFixed(1)},${y(0).toFixed(1)} L${x(0).toFixed(1)},${y(0).toFixed(1)} Z`;
  const resolvedLine = lineFor("resolved");
  const netLine = lineFor("net");

  // 5 evenly spaced gridlines across the current domain (which may be signed).
  const gridLines = [0, 0.25, 0.5, 0.75, 1].map((frac) => domainMin + frac * domainRange);
  // Label roughly every ~6th day so the axis doesn't crowd.
  const step = Math.max(1, Math.round(n / 5));
  const xLabels = data.map((d, i) => ({ i, d })).filter(({ i }) => i % step === 0 || i === n - 1);

  function onMove(e: React.MouseEvent<HTMLDivElement>) {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect || n === 0) return;
    const fracX = (e.clientX - rect.left) / rect.width;
    const i = Math.min(n - 1, Math.max(0, Math.round(fracX * (n - 1))));
    setHover(i);
  }

  const hovered = hover !== null ? data[hover] : null;
  // Tooltip position as a percentage of the container, so it tracks the
  // point regardless of the chart's actual rendered size (viewBox scaling).
  const tipLeftPct = hover !== null ? (x(hover) / W) * 100 : 0;
  const tipTopPct = hovered
    ? (Math.min(
        ...(["created", "resolved", "net"] as const).filter((s) => visible.has(s)).map((s) => y(hovered[s]))
      ) /
        H) *
      100
    : 0;

  return (
    <div>
      <div className="flex items-center gap-3 mb-2">
        {(["created", "resolved", "net"] as const).map((s) => {
          const meta = SERIES_META[s];
          const active = visible.has(s);
          return (
            <button
              key={s}
              type="button"
              onClick={() => toggleSeries(s)}
              className={`flex items-center gap-1.5 text-[12px] font-medium rounded-full px-2 py-1 transition-opacity duration-150 cursor-pointer hover:bg-black/[0.04] dark:hover:bg-white/[0.06] ${
                active ? "opacity-100" : "opacity-40"
              }`}
            >
              <span
                className="h-2 w-2 rounded-full shrink-0"
                style={{ backgroundColor: meta.color }}
              />
              <span className="text-[var(--color-neutral-700)]">{meta.label}</span>
            </button>
          );
        })}
      </div>
      <div ref={containerRef} className="relative" onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto block" role="img" aria-label="Tickets created, resolved, and net over time">
          <defs>
            <linearGradient id="trend-created" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--color-primary)" stopOpacity="0.28" />
              <stop offset="100%" stopColor="var(--color-primary)" stopOpacity="0" />
            </linearGradient>
          </defs>

          {gridLines.map((g, idx) => {
            const gy = y(g);
            return (
              <g key={idx}>
                <line
                  x1={padL}
                  y1={gy}
                  x2={W - padR}
                  y2={gy}
                  stroke={g === 0 && showNet ? "var(--color-neutral-300)" : "var(--color-neutral-100)"}
                  strokeWidth="1"
                />
                <text x={padL - 6} y={gy + 3} textAnchor="end" fontSize="9" fill="var(--color-neutral-400)">
                  {Math.round(g)}
                </text>
              </g>
            );
          })}

          {visible.has("created") && <path d={createdArea} fill="url(#trend-created)" />}
          {visible.has("created") && (
            <path d={createdLine} fill="none" stroke="var(--color-primary)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
          )}
          {visible.has("resolved") && (
            <path d={resolvedLine} fill="none" stroke="var(--color-neutral-700)" strokeWidth="1.5" strokeDasharray="4 3" strokeLinejoin="round" strokeLinecap="round" />
          )}
          {showNet && (
            <path d={netLine} fill="none" stroke="var(--color-neutral-400)" strokeWidth="1.5" strokeDasharray="2 3" strokeLinejoin="round" strokeLinecap="round" />
          )}

          {hover !== null && (
            <line x1={x(hover)} y1={padT} x2={x(hover)} y2={padT + innerH} stroke="var(--color-neutral-300)" strokeWidth="1" strokeDasharray="3 3" />
          )}

          {data.map((d, i) => (
            <g key={d.date}>
              {visible.has("created") && (
                <circle cx={x(i)} cy={y(d.created)} r={hover === i ? 4 : 2.5} fill="var(--color-primary)" className="transition-[r] duration-100" />
              )}
              {visible.has("resolved") && (
                <circle cx={x(i)} cy={y(d.resolved)} r={hover === i ? 3.5 : 2} fill="var(--color-neutral-700)" className="transition-[r] duration-100" />
              )}
              {showNet && (
                <circle cx={x(i)} cy={y(d.net)} r={hover === i ? 3.5 : 2} fill="var(--color-neutral-400)" className="transition-[r] duration-100" />
              )}
            </g>
          ))}

          {xLabels.map(({ i, d }) => (
            <text key={d.date} x={x(i)} y={H - 8} textAnchor="middle" fontSize="9" fill="var(--color-neutral-400)">
              {fmtDay(d.date)}
            </text>
          ))}
        </svg>

        {hovered && (
          <div
            className="absolute z-10 pointer-events-none bg-black text-white rounded-xl px-3 py-2 text-[11px] shadow-[0_8px_24px_-6px_rgba(0,0,0,0.4)] whitespace-nowrap"
            style={{
              left: `${tipLeftPct}%`,
              top: `${Math.max(tipTopPct, 6)}%`,
              transform: "translate(-50%, -120%)",
            }}
          >
            <p className="font-semibold mb-1">{fmtDay(hovered.date)}</p>
            {visible.has("created") && (
              <p className="flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-primary)]" />
                {hovered.created} created
              </p>
            )}
            {visible.has("resolved") && (
              <p className="flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-white/70" />
                {hovered.resolved} resolved
              </p>
            )}
            {showNet && (
              <p className="flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-white/40" />
                {hovered.net > 0 ? `+${hovered.net}` : hovered.net} net
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

type Segment = { label: string; value: number; color: string };

/** Donut with a centered total and a legend. */
export function DonutChart({
  segments,
  total,
  ariaLabel = "Tickets by status",
}: {
  segments: Segment[];
  total: number;
  ariaLabel?: string;
}) {
  const size = 160;
  const stroke = 26;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const sum = total || segments.reduce((s, seg) => s + seg.value, 0);

  let acc = 0;
  return (
    <div className="flex items-center gap-5">
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} className="shrink-0" role="img" aria-label={ariaLabel}>
        <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--color-neutral-100)" strokeWidth={stroke} />
          {sum > 0 &&
            segments.map((seg) => {
              const frac = seg.value / sum;
              const dash = frac * c;
              const el = (
                <circle
                  key={seg.label}
                  cx={size / 2}
                  cy={size / 2}
                  r={r}
                  fill="none"
                  stroke={seg.color}
                  strokeWidth={stroke}
                  strokeDasharray={`${dash} ${c - dash}`}
                  strokeDashoffset={-acc * c}
                >
                  <title>{`${seg.label}: ${seg.value} (${Math.round(frac * 100)}%)`}</title>
                </circle>
              );
              acc += frac;
              return el;
            })}
        </g>
        <text x={size / 2} y={size / 2 - 2} textAnchor="middle" fontSize="26" fontWeight="700" fill="var(--foreground)">
          {sum}
        </text>
        <text x={size / 2} y={size / 2 + 16} textAnchor="middle" fontSize="10" fill="var(--color-neutral-600)">
          total
        </text>
      </svg>
      <ul className="space-y-1.5 text-[13px]">
        {segments.map((seg) => (
          <li key={seg.label} className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-sm shrink-0" style={{ backgroundColor: seg.color }} />
            <span className="text-[var(--color-neutral-700)]">{seg.label}</span>
            <span className="font-mono font-semibold ml-auto tabular-nums">{seg.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Horizontal proportional bars (used for priority breakdown). */
export function BarList({ items }: { items: Segment[] }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <div className="space-y-3">
      {items.map((it) => (
        <div key={it.label}>
          <div className="flex items-center justify-between text-[13px] mb-1">
            <span className="text-[var(--color-neutral-700)]">{it.label}</span>
            <span className="font-mono font-semibold tabular-nums">{it.value}</span>
          </div>
          <div className="h-2 rounded-full bg-[var(--color-neutral-100)] overflow-hidden">
            <div
              className="h-full rounded-full transition-[width] duration-500"
              style={{ width: `${(it.value / max) * 100}%`, backgroundColor: it.color }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * Day-of-week x hour-of-day activity heatmap (ticket creation volume).
 * `grid[dayOfWeek 0-6][hourOfDay 0-23]`. Deliberately a CSS grid of divs
 * (not SVG) — each cell is a single `bg-[var(--color-primary)]` swatch with
 * `opacity` scaled by that cell's count, rather than interpolating between
 * hardcoded hex colors: opacity over one CSS variable always renders
 * correctly in both light and dark mode, which a literal color scale would
 * not (see the "In Progress segment invisible in dark mode" bug fixed
 * earlier — this avoids repeating it).
 */
export function HeatmapChart({ grid }: { grid: number[][] }) {
  const max = Math.max(1, ...grid.flat());

  return (
    <div className="overflow-x-auto">
      <div
        className="inline-grid gap-[3px]"
        style={{ gridTemplateColumns: "36px repeat(24, minmax(18px, 1fr))" }}
      >
        <div />
        {Array.from({ length: 24 }, (_, h) => (
          <div key={h} className="text-[9px] text-[var(--color-neutral-400)] text-center">
            {h}
          </div>
        ))}
        {grid.map((row, dayIdx) => (
          <div key={dayIdx} className="contents">
            <div className="text-[11px] text-[var(--color-neutral-600)] flex items-center">{DAY_LABELS[dayIdx]}</div>
            {row.map((count, hourIdx) => (
              <div
                key={hourIdx}
                title={`${DAY_LABELS[dayIdx]} ${hourIdx}:00 — ${count} ticket${count === 1 ? "" : "s"}`}
                className="aspect-square rounded-[3px] bg-[var(--color-primary)]"
                style={{ opacity: count === 0 ? 0.06 : 0.15 + (count / max) * 0.85 }}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Horizontal bars with a shared numeric axis + vertical gridlines (unlike
 * the plain proportional BarList above) — reuses the same gridline/axis
 * visual language as TrendChart (`var(--color-neutral-100)` lines,
 * `var(--color-neutral-400)` axis text) rather than inventing a new style.
 */
export function AxisBarChart({ items }: { items: Segment[] }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  const niceMax = niceCeil(max);
  const gridFracs = [0, 0.25, 0.5, 0.75, 1];

  return (
    <div>
      <div className="space-y-2.5">
        {items.map((it) => (
          <div key={it.label} className="flex items-center gap-3">
            <span className="w-24 shrink-0 truncate text-[12px] text-[var(--color-neutral-700)]" title={it.label}>
              {it.label}
            </span>
            <div className="relative flex-1 h-5">
              {gridFracs.map((g) => (
                <div
                  key={g}
                  className="absolute inset-y-0 border-l border-[var(--color-neutral-100)]"
                  style={{ left: `${g * 100}%` }}
                />
              ))}
              <div
                className="absolute inset-y-0 left-0 rounded-r-sm transition-[width] duration-500"
                style={{ width: `${Math.min(100, (it.value / niceMax) * 100)}%`, backgroundColor: it.color }}
              />
            </div>
            <span className="w-6 shrink-0 text-right font-mono text-[12px] font-semibold tabular-nums">{it.value}</span>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-3 mt-1.5">
        <span className="w-24 shrink-0" />
        <div className="relative flex-1 h-3">
          {gridFracs.map((g) => (
            <span
              key={g}
              className="absolute text-[9px] text-[var(--color-neutral-400)]"
              style={{ left: `${g * 100}%`, transform: g === 0 ? "none" : g === 1 ? "translateX(-100%)" : "translateX(-50%)" }}
            >
              {Math.round(g * niceMax)}
            </span>
          ))}
        </div>
        <span className="w-6 shrink-0" />
      </div>
    </div>
  );
}

type RegionPoint = {
  code: string | null;
  label: string;
  value: number;
  avgResolutionHours: number | null;
  lat: number | null;
  lon: number | null;
};

// Deliberately rough, hand-drawn landmass silhouettes — not real coastlines
// (no world-map asset or mapping library in this repo, and the mockup this
// is based on shows a stylized illustration, not a precise choropleth).
// Purely a backdrop; the actual data is the projected dots below.
const LANDMASS_PATHS = [
  "M40,60 Q30,40 70,35 Q120,30 140,55 Q150,80 120,100 Q90,120 60,105 Q35,90 40,60Z", // North America
  "M100,140 Q90,160 100,190 Q110,220 130,215 Q140,190 135,160 Q125,140 100,140Z", // South America
  "M260,50 Q290,40 310,55 Q320,75 300,85 Q275,90 260,75 Q255,60 260,50Z", // Europe
  "M270,90 Q300,85 315,110 Q325,150 300,180 Q280,190 270,160 Q260,120 270,90Z", // Africa
  "M340,45 Q400,30 460,55 Q490,80 470,110 Q420,120 370,100 Q335,80 340,45Z", // Asia
  "M470,210 Q500,200 520,215 Q525,230 505,235 Q480,232 470,210Z", // Australia
];

/**
 * Stylized "clients by region" illustration: a static, approximate world
 * backdrop with dot markers plotted from a small country-centroid lookup
 * (src/lib/countries.ts) via a basic equirectangular projection, sized/
 * colored by ticket volume. Opacity over one CSS variable (not hardcoded
 * hex) to stay dark-mode-safe, same approach as HeatmapChart above.
 */
export function RegionMap({ regions }: { regions: RegionPoint[] }) {
  const W = 560;
  const H = 260;
  const plottable = regions.filter((r): r is RegionPoint & { lat: number; lon: number } => r.lat !== null && r.lon !== null);
  const max = Math.max(1, ...plottable.map((r) => r.value));

  const project = (lat: number, lon: number) => ({
    x: ((lon + 180) / 360) * W,
    y: ((90 - lat) / 180) * H,
  });

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto block" role="img" aria-label="Clients by region">
      <rect x="0" y="0" width={W} height={H} rx="12" fill="var(--color-neutral-100)" opacity="0.5" />
      {LANDMASS_PATHS.map((d, i) => (
        <path key={i} d={d} fill="var(--color-neutral-300)" opacity="0.55" />
      ))}
      {plottable.map((r) => {
        const { x, y } = project(r.lat, r.lon);
        const radius = 4 + (r.value / max) * 10;
        return (
          <circle key={r.code ?? r.label} cx={x} cy={y} r={radius} fill="var(--color-primary)" opacity={0.35 + (r.value / max) * 0.55}>
            <title>
              {`${r.label}: ${r.value} ticket${r.value === 1 ? "" : "s"}${
                r.avgResolutionHours !== null ? ` · avg resolution ${r.avgResolutionHours.toFixed(1)}h` : ""
              }`}
            </title>
          </circle>
        );
      })}
    </svg>
  );
}

function niceCeil(v: number) {
  if (v <= 5) return 5;
  const pow = Math.pow(10, Math.floor(Math.log10(v)));
  const step = pow / 2;
  return Math.ceil(v / step) * step;
}

function fmtDay(iso: string) {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
