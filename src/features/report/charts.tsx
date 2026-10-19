import { useState, type ReactNode } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from 'recharts';

const AXIS = { stroke: 'var(--chart-grid)', tick: { fill: 'var(--chart-axis)', fontSize: 12 }, tickLine: false };
const GRID = <CartesianGrid stroke="var(--chart-grid)" vertical={false} />;

export interface Column<T> {
  label: string;
  value: (row: T) => string;
}

/** Every chart has a table twin, so no value is reachable only by hovering. */
export function ChartCard<T>({ title, subtitle, rows, columns, children, empty }: {
  title: string;
  subtitle?: string;
  rows: T[];
  columns: Column<T>[];
  children: ReactNode;
  empty?: string;
}) {
  const [table, setTable] = useState(false);
  return (
    <section className="grid gap-3 rounded-[24px] border border-line bg-surface p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">{title}</h2>
          {subtitle && <p className="text-sm text-muted">{subtitle}</p>}
        </div>
        {rows.length > 0 && (
          <button
            type="button"
            aria-pressed={table}
            onClick={() => setTable(!table)}
            className="shrink-0 rounded-full bg-surface-2 px-3 py-1.5 text-xs font-semibold hover:brightness-95"
          >
            {table ? 'Show chart' : 'Show as table'}
          </button>
        )}
      </div>
      {rows.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted">{empty ?? 'No data for this week yet.'}</p>
      ) : table ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-muted">
                {columns.map((c) => (
                  <th key={c.label} className="py-1.5 pr-3 font-medium">
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i} className="border-b border-line">
                  {columns.map((c) => (
                    <td key={c.label} className="py-1.5 pr-3 tabular-nums">
                      {c.value(row)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="h-56 w-full">{children}</div>
      )}
    </section>
  );
}

function TooltipBox({ active, payload, label, format }: Partial<TooltipContentProps<number, string>> & { format: (v: number, name: string) => string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-2xl bg-surface px-3 py-2 text-xs shadow-lg ring-1 ring-line">
      <p className="mb-1 font-semibold text-fg">{label}</p>
      {payload.map((p) => (
        <p key={String(p.dataKey)} className="flex items-center gap-1.5 text-muted">
          <span className="h-2 w-2 rounded-sm" style={{ background: p.color }} aria-hidden />
          {p.name}: <span className="font-semibold text-fg">{format(Number(p.value), String(p.name))}</span>
        </p>
      ))}
    </div>
  );
}

const cursor = { fill: 'var(--chart-grid)', opacity: 0.5 };

/** Charts don't animate in for people who asked for less motion. */
const animate = typeof window === 'undefined' || !window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Legend labels stay in text ink; the swatch beside them carries the series colour. */
const legendText = (value: string) => <span style={{ color: 'var(--chart-axis)' }}>{value}</span>;

/** Minutes as "45m" below an hour, "1.5h" above, so small totals get even ticks. */
export const minutesTick = (v: number): string => (v < 60 ? `${Math.round(v)}m` : `${Math.round((v / 60) * 10) / 10}h`);

/** One measure across categories: one colour, thin bars, rounded data end. */
export function SingleBars({ data, x, y, name, format, max, layout = 'vertical' }: {
  data: object[];
  x: string;
  y: string;
  name: string;
  format: (v: number) => string;
  max?: number;
  layout?: 'vertical' | 'horizontal';
}) {
  const horizontal = layout === 'horizontal';
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} layout={horizontal ? 'vertical' : 'horizontal'} margin={{ top: 8, right: 12, bottom: 0, left: horizontal ? 8 : -12 }} barCategoryGap="28%">
        {horizontal ? <CartesianGrid stroke="var(--chart-grid)" horizontal={false} /> : GRID}
        {horizontal ? (
          <>
            <XAxis type="number" {...AXIS} tickFormatter={(v: number) => format(v)} domain={[0, max ?? 'auto']} />
            <YAxis type="category" dataKey={x} {...AXIS} width={84} />
          </>
        ) : (
          <>
            <XAxis dataKey={x} {...AXIS} />
            <YAxis {...AXIS} tickFormatter={(v: number) => format(v)} domain={[0, max ?? 'auto']} width={48} />
          </>
        )}
        <Tooltip cursor={cursor} content={<TooltipBox format={(v) => format(v)} />} />
        <Bar isAnimationActive={animate} dataKey={y} name={name} fill="var(--series-1)" radius={horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0]} maxBarSize={28} />
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Two series on the same scale: grouped bars with a 2px gap and a legend. */
export function PairedBars({ data, x, a, b, format }: {
  data: object[];
  x: string;
  a: { key: string; name: string };
  b: { key: string; name: string };
  format: (v: number) => string;
}) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: -12 }} barGap={2} barCategoryGap="24%">
        {GRID}
        <XAxis dataKey={x} {...AXIS} />
        <YAxis {...AXIS} tickFormatter={(v: number) => format(v)} width={48} />
        <Tooltip cursor={cursor} content={<TooltipBox format={(v) => format(v)} />} />
        <Legend iconType="square" iconSize={10} itemSorter={null} formatter={legendText} wrapperStyle={{ fontSize: 12 }} />
        <Bar isAnimationActive={animate} dataKey={a.key} name={a.name} fill="var(--series-1)" radius={[4, 4, 0, 0]} maxBarSize={22} />
        <Bar isAnimationActive={animate} dataKey={b.key} name={b.name} fill="var(--series-2)" radius={[4, 4, 0, 0]} maxBarSize={22} />
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Two 1-5 ratings over time on one shared axis. */
export function PairedLines({ data, x, a, b }: {
  data: object[];
  x: string;
  a: { key: string; name: string };
  b: { key: string; name: string };
}) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: -24 }}>
        {GRID}
        <XAxis dataKey={x} {...AXIS} />
        <YAxis {...AXIS} domain={[1, 5]} ticks={[1, 2, 3, 4, 5]} width={40} />
        <Tooltip cursor={{ stroke: 'var(--chart-axis)', strokeWidth: 1 }} content={<TooltipBox format={(v) => `${v} / 5`} />} />
        <Legend iconType="plainline" iconSize={14} itemSorter={null} formatter={legendText} wrapperStyle={{ fontSize: 12 }} />
        <Line isAnimationActive={animate} type="monotone" dataKey={a.key} name={a.name} stroke="var(--series-1)" strokeWidth={2} dot={{ r: 4, strokeWidth: 2, stroke: 'var(--chart-surface)', fill: 'var(--series-1)' }} activeDot={{ r: 5, fill: 'var(--series-1)' }} connectNulls />
        <Line isAnimationActive={animate} type="monotone" dataKey={b.key} name={b.name} stroke="var(--series-2)" strokeWidth={2} dot={{ r: 4, strokeWidth: 2, stroke: 'var(--chart-surface)', fill: 'var(--series-2)' }} activeDot={{ r: 5, fill: 'var(--series-2)' }} connectNulls />
      </LineChart>
    </ResponsiveContainer>
  );
}
