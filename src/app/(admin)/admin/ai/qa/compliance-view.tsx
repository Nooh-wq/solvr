"use client";

import type { Rubric } from "@/lib/ai/qa";
import type { ComplianceRow } from "@/actions/qaScores";

export function ComplianceView({
  rubric,
  rows,
  correlation,
}: {
  rubric: Rubric | null;
  rows: ComplianceRow[];
  correlation: Array<{ overall: number; rating: number }>;
}) {
  if (!rubric) {
    return (
      <div className="bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl p-8 text-center text-sm text-[var(--color-neutral-600)]">
        No active rubric — visit <span className="font-medium">Rubric</span> to seed the default.
      </div>
    );
  }
  if (rows.length === 0) {
    return (
      <div className="bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl p-8 text-center text-sm text-[var(--color-neutral-600)]">
        No scored replies yet in the last 30 days.
      </div>
    );
  }

  const overallSeries = rows.map((r) => ({ x: r.date, y: r.overall }));
  const perDim = rubric.map((d) => ({
    key: d.key,
    label: d.label,
    series: rows.map((r) => ({ x: r.date, y: r.perDimension[d.key] ?? 0 })),
    avg:
      rows.reduce((s, r) => s + (r.perDimension[d.key] ?? 0), 0) /
      Math.max(1, rows.length),
  }));

  return (
    <div className="space-y-6">
      <section className="bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl p-5">
        <div className="text-[12px] uppercase-label text-[var(--color-neutral-700)] mb-3">
          Overall (30-day rolling)
        </div>
        <Sparkline series={overallSeries} yMin={0} yMax={5} />
      </section>

      <section className="grid grid-cols-2 gap-4">
        {perDim.map((d) => (
          <div
            key={d.key}
            className="bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl p-5"
          >
            <div className="flex justify-between items-baseline mb-2">
              <div className="text-[13px] font-semibold">{d.label}</div>
              <div className="text-[12px] text-[var(--color-neutral-600)]">
                avg {d.avg.toFixed(2)} / 5
              </div>
            </div>
            <Sparkline series={d.series} yMin={0} yMax={5} />
          </div>
        ))}
      </section>

      <section className="bg-[var(--color-surface)] border border-[var(--color-neutral-300)] rounded-2xl p-5">
        <div className="text-[12px] uppercase-label text-[var(--color-neutral-700)] mb-1">
          CSAT correlation
        </div>
        <div className="text-[12px] text-[var(--color-neutral-600)] mb-3">
          Each dot is a resolved ticket that got a CSAT response and had at least one scored reply. Higher-right
          = high QA + happy customer. Low-right = QA looks good but CSAT tanked (rubric might be missing an axis).
        </div>
        {correlation.length === 0 ? (
          <div className="text-[13px] text-[var(--color-neutral-600)]">
            Not enough paired data yet.
          </div>
        ) : (
          <CorrelationScatter data={correlation} />
        )}
      </section>
    </div>
  );
}

function Sparkline({
  series,
  yMin,
  yMax,
}: {
  series: Array<{ x: string; y: number }>;
  yMin: number;
  yMax: number;
}) {
  const W = 640;
  const H = 120;
  const PAD = 20;
  const range = yMax - yMin || 1;
  const points = series.map((p, i) => {
    const x = PAD + (i / Math.max(1, series.length - 1)) * (W - 2 * PAD);
    const y = H - PAD - ((p.y - yMin) / range) * (H - 2 * PAD);
    return `${x},${y}`;
  });
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-32">
      <line
        x1={PAD}
        x2={W - PAD}
        y1={H - PAD}
        y2={H - PAD}
        stroke="var(--color-neutral-200)"
      />
      <line
        x1={PAD}
        x2={W - PAD}
        y1={H / 2}
        y2={H / 2}
        stroke="var(--color-neutral-100)"
        strokeDasharray="2 2"
      />
      {points.length > 1 ? (
        <polyline
          points={points.join(" ")}
          fill="none"
          stroke="var(--color-primary)"
          strokeWidth={1.5}
        />
      ) : null}
      {points.map((p, i) => {
        const [x, y] = p.split(",");
        return <circle key={i} cx={x} cy={y} r={2} fill="var(--color-primary)" />;
      })}
    </svg>
  );
}

function CorrelationScatter({
  data,
}: {
  data: Array<{ overall: number; rating: number }>;
}) {
  const W = 480;
  const H = 240;
  const PAD = 30;
  const xMax = 5;
  const yMax = 5; // CSAT is 1-5 by default; NPS is filtered upstream
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full max-w-md">
      <line
        x1={PAD}
        x2={W - PAD}
        y1={H - PAD}
        y2={H - PAD}
        stroke="var(--color-neutral-300)"
      />
      <line
        x1={PAD}
        x2={PAD}
        y1={PAD}
        y2={H - PAD}
        stroke="var(--color-neutral-300)"
      />
      <text
        x={W / 2}
        y={H - 4}
        textAnchor="middle"
        fill="var(--color-neutral-600)"
        fontSize="10"
      >
        QA overall →
      </text>
      <text
        x={10}
        y={H / 2}
        textAnchor="middle"
        transform={`rotate(-90 10 ${H / 2})`}
        fill="var(--color-neutral-600)"
        fontSize="10"
      >
        CSAT rating →
      </text>
      {data.map((d, i) => {
        const x = PAD + (d.overall / xMax) * (W - 2 * PAD);
        const y = H - PAD - (d.rating / yMax) * (H - 2 * PAD);
        return <circle key={i} cx={x} cy={y} r={3} fill="var(--color-primary)" opacity={0.5} />;
      })}
    </svg>
  );
}
