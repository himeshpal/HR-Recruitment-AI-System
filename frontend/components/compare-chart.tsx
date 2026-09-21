"use client";

import { useState, type FocusEvent, type PointerEvent } from "react";

import { cn } from "@/lib/utils";

export type Series = { id: number; label: string };
export type Dimension = { key: string; label: string; values: (number | null)[] };
export type ChartView = "bars" | "radar" | "table";

// Identity is never colour alone: each series also has its own marker shape.
const SHAPES = ["circle", "square", "triangle"] as const;
const colorOf = (i: number) => `var(--series-${i + 1})`;

function Marker({ shape, size = 10, color, className }: { shape: (typeof SHAPES)[number]; size?: number; color: string; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 10 10" className={className} aria-hidden>
      {shape === "circle" && <circle cx="5" cy="5" r="4.5" fill={color} />}
      {shape === "square" && <rect x="0.5" y="0.5" width="9" height="9" rx="1" fill={color} />}
      {shape === "triangle" && <polygon points="5,0.5 9.5,9.5 0.5,9.5" fill={color} />}
    </svg>
  );
}

export function Legend({ series }: { series: Series[] }) {
  return (
    <ul className="flex flex-wrap gap-x-5 gap-y-1.5 text-sm" aria-label="Legend">
      {series.map((s, i) => (
        <li key={s.id} className="flex items-center gap-2">
          <Marker shape={SHAPES[i]} color={colorOf(i)} />
          {s.label}
        </li>
      ))}
    </ul>
  );
}

type Tip = { dim: number; x: number; y: number } | null;

/** Hover and keyboard tooltip shared by the bars and the radar: it shows every series for the dimension under the pointer. */
function useTooltip() {
  const [tip, setTip] = useState<Tip>(null);
  const at = (target: EventTarget | null, x: number, y: number) => {
    const el = (target as HTMLElement | null)?.closest?.("[data-dim]") as HTMLElement | null;
    setTip(el ? { dim: Number(el.dataset.dim), x, y } : null);
  };
  const handlers = {
    onPointerMove: (e: PointerEvent<HTMLElement>) => {
      const box = e.currentTarget.getBoundingClientRect();
      at(e.target, e.clientX - box.left, e.clientY - box.top);
    },
    onPointerLeave: () => setTip(null),
    onFocusCapture: (e: FocusEvent<HTMLElement>) => {
      const box = e.currentTarget.getBoundingClientRect();
      const target = e.target.getBoundingClientRect();
      at(e.target, target.left - box.left + target.width / 2, target.top - box.top);
    },
    onBlurCapture: () => setTip(null),
  };
  return { tip, handlers };
}

function TooltipBox({ tip, dims, series }: { tip: NonNullable<Tip>; dims: Dimension[]; series: Series[] }) {
  const dim = dims[tip.dim];
  return (
    <div
      role="tooltip"
      className="pointer-events-none absolute z-10 min-w-40 -translate-x-1/2 -translate-y-[115%] rounded-lg border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-lg"
      style={{ left: tip.x, top: tip.y }}
    >
      <p className="mb-1 font-semibold">{dim.label}</p>
      {series.map((s, i) => (
        <p key={s.id} className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-1.5">
            <Marker shape={SHAPES[i]} size={8} color={colorOf(i)} /> {s.label}
          </span>
          <span className="font-medium tabular-nums">{dim.values[i] === null ? "n/a" : `${Math.round(dim.values[i]!)} / 100`}</span>
        </p>
      ))}
    </div>
  );
}

function Bars({ series, dims }: { series: Series[]; dims: Dimension[] }) {
  const { tip, handlers } = useTooltip();
  return (
    <div className="relative space-y-3" {...handlers}>
      {dims.map((dim, d) => (
        <div key={dim.key} role="group" aria-label={dim.label} className="grid grid-cols-[6.5rem_1fr] items-center gap-3 sm:grid-cols-[8rem_1fr]">
          <span className="text-sm text-muted-foreground">{dim.label}</span>
          <div className="space-y-[2px]">
            {series.map((s, i) => {
              const v = dim.values[i];
              return (
                <div
                  key={s.id}
                  data-dim={d}
                  tabIndex={0}
                  role="img"
                  aria-label={`${s.label}: ${dim.label} ${v === null ? "not available" : `${Math.round(v)} out of 100`}`}
                  className="flex items-center gap-2 rounded outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <div className="h-3.5 flex-1 overflow-hidden rounded-[4px] bg-muted/60">
                    {v !== null && (
                      <div
                        className="h-full rounded-r-[4px] transition-[width] duration-700"
                        style={{ width: `${Math.max(v, 1)}%`, background: colorOf(i) }}
                      />
                    )}
                  </div>
                  <span className="w-8 text-right text-xs tabular-nums">{v === null ? "n/a" : Math.round(v)}</span>
                </div>
              );
            })}
          </div>
        </div>
      ))}
      {tip && <TooltipBox tip={tip} dims={dims} series={series} />}
    </div>
  );
}

const SIZE = 380;
const CENTER = SIZE / 2;
const RADIUS = 112;
const RINGS = [25, 50, 75, 100];

function polar(index: number, count: number, value: number, radius = RADIUS) {
  const angle = -Math.PI / 2 + (index * 2 * Math.PI) / count;
  const r = (radius * value) / 100;
  return { x: CENTER + r * Math.cos(angle), y: CENTER + r * Math.sin(angle), cos: Math.cos(angle), sin: Math.sin(angle) };
}

function Radar({ series, dims }: { series: Series[]; dims: Dimension[] }) {
  const { tip, handlers } = useTooltip();
  // A radar cannot show a missing value honestly, so axes where any candidate has none are left to the bars and table.
  const axes = dims.map((d, index) => ({ d, index })).filter(({ d }) => d.values.every((v) => v !== null));
  if (axes.length < 3) {
    return <p className="py-8 text-center text-sm text-muted-foreground">Not enough scores to draw a radar yet. Use the bars or the table.</p>;
  }
  const n = axes.length;
  const ringPoints = (v: number) => axes.map((_, i) => polar(i, n, v)).map((p) => `${p.x},${p.y}`).join(" ");
  // The tooltip needs coordinates in the container's pixel space, not in viewBox units.
  const scale = (p: { x: number; y: number }) => ({ left: `${(p.x / SIZE) * 100}%`, top: `${(p.y / SIZE) * 100}%` });

  return (
    <div className="relative mx-auto w-full max-w-[460px]" {...handlers}>
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="w-full" role="img" aria-label="Radar chart comparing the candidates' scores. The table view has the same numbers.">
        {RINGS.map((v) => (
          <polygon key={v} points={ringPoints(v)} fill="none" className="stroke-border" strokeWidth={1} />
        ))}
        {axes.map(({ d }, i) => {
          const edge = polar(i, n, 100);
          const label = polar(i, n, 100, RADIUS + 20);
          const lines = d.label.length > 11 && d.label.includes(" ") ? [d.label.slice(0, d.label.indexOf(" ", 4)), d.label.slice(d.label.indexOf(" ", 4) + 1)] : [d.label];
          return (
            <g key={d.key}>
              <line x1={CENTER} y1={CENTER} x2={edge.x} y2={edge.y} className="stroke-border" strokeWidth={1} />
              <text x={label.x} y={label.y} textAnchor={label.cos > 0.3 ? "start" : label.cos < -0.3 ? "end" : "middle"} className="fill-foreground text-[11px]">
                {lines.map((line, k) => (
                  <tspan key={k} x={label.x} dy={k === 0 ? (lines.length > 1 ? "-0.2em" : "0.35em") : "1.15em"}>
                    {line}
                  </tspan>
                ))}
              </text>
            </g>
          );
        })}
        {RINGS.map((v) => (
          <text key={v} x={CENTER + 4} y={CENTER - (RADIUS * v) / 100 + 10} className="fill-muted-foreground text-[9px]">
            {v}
          </text>
        ))}
        {series.map((s, si) => {
          const pts = axes.map(({ d }, i) => polar(i, n, d.values[si]!));
          return (
            <g key={s.id}>
              <polygon points={pts.map((p) => `${p.x},${p.y}`).join(" ")} fill={colorOf(si)} fillOpacity={0.12} stroke={colorOf(si)} strokeWidth={2} strokeLinejoin="round" />
              {pts.map((p, i) => {
                const common = { fill: colorOf(si), className: "stroke-card", strokeWidth: 2 };
                return (
                  <g key={i}>
                    {SHAPES[si] === "circle" && <circle cx={p.x} cy={p.y} r={5} {...common} />}
                    {SHAPES[si] === "square" && <rect x={p.x - 4.5} y={p.y - 4.5} width={9} height={9} rx={1} {...common} />}
                    {SHAPES[si] === "triangle" && <polygon points={`${p.x},${p.y - 6} ${p.x + 5.5},${p.y + 4.5} ${p.x - 5.5},${p.y + 4.5}`} {...common} />}
                  </g>
                );
              })}
            </g>
          );
        })}
      </svg>
      {/* Hit targets sit outside the SVG so they can be focused with the keyboard and be larger than the marks. */}
      {axes.map(({ index }, i) => {
        const p = polar(i, n, Math.max(...series.map((_, si) => axes[i].d.values[si]!)));
        return (
          <button
            key={index}
            type="button"
            data-dim={index}
            aria-label={`${axes[i].d.label}: ${series.map((s, si) => `${s.label} ${Math.round(axes[i].d.values[si]!)}`).join(", ")}`}
            className="absolute size-9 -translate-x-1/2 -translate-y-1/2 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
            style={scale(p)}
          />
        );
      })}
      {tip && <TooltipBox tip={tip} dims={dims} series={series} />}
    </div>
  );
}

function DataTable({ series, dims }: { series: Series[]; dims: Dimension[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <caption className="sr-only">Scores out of 100 for each candidate</caption>
        <thead>
          <tr className="border-b text-left text-xs text-muted-foreground">
            <th scope="col" className="py-2 pr-4 font-medium">
              Score
            </th>
            {series.map((s, i) => (
              <th key={s.id} scope="col" className="px-2 py-2 font-medium">
                <span className="flex items-center gap-1.5">
                  <Marker shape={SHAPES[i]} size={8} color={colorOf(i)} /> {s.label}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {dims.map((dim) => (
            <tr key={dim.key} className="border-b last:border-0">
              <th scope="row" className="py-2 pr-4 text-left font-normal text-muted-foreground">
                {dim.label}
              </th>
              {dim.values.map((v, i) => (
                <td key={i} className="px-2 py-2 tabular-nums">
                  {v === null ? "n/a" : Math.round(v)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function CompareChart({ series, dims, view, className }: { series: Series[]; dims: Dimension[]; view: ChartView; className?: string }) {
  return (
    <div className={cn("viz-root space-y-4", className)}>
      <Legend series={series} />
      {view === "bars" && <Bars series={series} dims={dims} />}
      {view === "radar" && <Radar series={series} dims={dims} />}
      {view === "table" && <DataTable series={series} dims={dims} />}
    </div>
  );
}
