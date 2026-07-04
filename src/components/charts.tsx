// Lightweight, dependency-free SVG charts for the admin Overview. Server
// components (pure markup, no interactivity beyond native <title> tooltips),
// styled to the Solvr palette. Kept intentionally small — if charting needs
// grow (zoom, live updates, legends toggling) swap these for a real lib.

type TrendPoint = { date: string; created: number; resolved: number };

/**
 * Two-series area/line chart of tickets created vs. resolved over a window.
 * Fixed viewBox + w-full makes it responsive without distortion.
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

  const maxVal = Math.max(1, ...data.map((d) => Math.max(d.created, d.resolved)));
  // "Nice" y-axis top rounded up so gridlines land on round numbers.
  const niceMax = niceCeil(maxVal);
  const n = data.length;

  const x = (i: number) => padL + (n <= 1 ? innerW / 2 : (i / (n - 1)) * innerW);
  const y = (v: number) => padT + innerH - (v / niceMax) * innerH;

  const createdLine = data.map((d, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(d.created).toFixed(1)}`).join(" ");
  const createdArea = `${createdLine} L${x(n - 1).toFixed(1)},${(padT + innerH).toFixed(1)} L${x(0).toFixed(1)},${(padT + innerH).toFixed(1)} Z`;
  const resolvedLine = data.map((d, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(d.resolved).toFixed(1)}`).join(" ");

  const gridLines = [0, 0.25, 0.5, 0.75, 1];
  // Label roughly every ~6th day so the axis doesn't crowd.
  const step = Math.max(1, Math.round(n / 5));
  const xLabels = data.map((d, i) => ({ i, d })).filter(({ i }) => i % step === 0 || i === n - 1);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label="Tickets created and resolved over time">
      <defs>
        <linearGradient id="trend-created" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--color-primary)" stopOpacity="0.28" />
          <stop offset="100%" stopColor="var(--color-primary)" stopOpacity="0" />
        </linearGradient>
      </defs>

      {gridLines.map((g) => {
        const gy = padT + innerH - g * innerH;
        return (
          <g key={g}>
            <line x1={padL} y1={gy} x2={W - padR} y2={gy} stroke="var(--color-neutral-100)" strokeWidth="1" />
            <text x={padL - 6} y={gy + 3} textAnchor="end" fontSize="9" fill="var(--color-neutral-400)">
              {Math.round(g * niceMax)}
            </text>
          </g>
        );
      })}

      <path d={createdArea} fill="url(#trend-created)" />
      <path d={createdLine} fill="none" stroke="var(--color-primary)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      <path d={resolvedLine} fill="none" stroke="var(--color-neutral-700)" strokeWidth="1.5" strokeDasharray="4 3" strokeLinejoin="round" strokeLinecap="round" />

      {data.map((d, i) => (
        <g key={d.date}>
          <circle cx={x(i)} cy={y(d.created)} r="2.5" fill="var(--color-primary)" />
          <circle cx={x(i)} cy={y(d.resolved)} r="2" fill="var(--color-neutral-700)" />
          {/* Full-height hover target with a native tooltip. */}
          <rect x={x(i) - innerW / (2 * n)} y={padT} width={innerW / n} height={innerH} fill="transparent">
            <title>{`${fmtDay(d.date)} · ${d.created} created · ${d.resolved} resolved`}</title>
          </rect>
        </g>
      ))}

      {xLabels.map(({ i, d }) => (
        <text key={d.date} x={x(i)} y={H - 8} textAnchor="middle" fontSize="9" fill="var(--color-neutral-400)">
          {fmtDay(d.date)}
        </text>
      ))}
    </svg>
  );
}

type Segment = { label: string; value: number; color: string };

/** Donut with a centered total and a legend. */
export function DonutChart({ segments, total }: { segments: Segment[]; total: number }) {
  const size = 160;
  const stroke = 26;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const sum = total || segments.reduce((s, seg) => s + seg.value, 0);

  let acc = 0;
  return (
    <div className="flex items-center gap-5">
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} className="shrink-0" role="img" aria-label="Tickets by status">
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
        <text x={size / 2} y={size / 2 - 2} textAnchor="middle" fontSize="26" fontWeight="700" fill="var(--color-black)">
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
