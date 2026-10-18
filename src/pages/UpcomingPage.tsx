import { CalendarDays, Flag, Lock } from 'lucide-react';
import { useMemo } from 'react';
import { Card, EmptyState, Skeleton } from '../components/ui';
import { DeadlineRiskPanel } from '../features/upcoming/DeadlineRiskPanel';
import type { PlannerData } from '../hooks/useData';
import { collectFixed } from '../lib/scheduler';
import { addDaysTz, endOfDayTz, formatDayLabel, formatDuration, formatTime, MIN, startOfDayTz } from '../lib/time/tz';
import { useUi } from '../store/ui';

interface Row {
  key: string;
  at: number;
  label: string;
  detail: string;
  taskId?: string;
  kind: 'block' | 'fixed' | 'deadline';
}

export function UpcomingPage({ data }: { data: PlannerData }) {
  const { tasks, fixedEvents, profile, now, livePlan, loading } = data;
  const tz = profile.timezone;
  const select = useUi((s) => s.select);

  const days = useMemo(() => {
    const first = startOfDayTz(now, tz);
    const fixed = collectFixed({ tasks, fixedEvents });
    const active = tasks.filter((t) => ['todo', 'scheduled', 'doing'].includes(t.status));

    return Array.from({ length: 7 }, (_, i) => {
      const start = addDaysTz(first, i, tz);
      const end = endOfDayTz(start, tz);
      const rows: Row[] = [];
      let plannedMin = 0;

      for (const t of active) {
        // a long task split into many chunks is one row per day, not one per chunk
        const todays = t.blocks.filter((b) => b.start >= start && b.start <= end).sort((a, b) => a.start - b.start);
        if (todays.length) {
          const minutes = todays.reduce((sum, b) => sum + (b.end - b.start) / MIN, 0);
          plannedMin += minutes;
          const first = todays[0];
          const last = todays[todays.length - 1];
          rows.push({
            key: `${t.id}:${start}`,
            at: first.start,
            kind: 'block',
            taskId: t.id,
            label: t.title,
            detail:
              todays.length === 1
                ? `${formatTime(first.start, tz)} – ${formatTime(first.end, tz)}${first.chunks > 1 ? ` · part ${first.chunk}/${first.chunks}` : ''}`
                : `${formatDuration(minutes)} in ${todays.length} blocks · ${formatTime(first.start, tz)} – ${formatTime(last.end, tz)}`,
          });
        }
        if (t.dueAt !== undefined && t.dueAt >= start && t.dueAt <= end) {
          rows.push({ key: `due-${t.id}`, at: t.dueAt, kind: 'deadline', taskId: t.id, label: t.title, detail: 'Deadline' });
        }
      }
      for (const f of fixed) {
        if (f.start >= start && f.start <= end && !f.done) {
          rows.push({
            key: f.id,
            at: f.start,
            kind: 'fixed',
            taskId: f.taskId,
            label: f.title,
            detail: `${formatTime(f.start, tz)} – ${formatTime(f.end, tz)}`,
          });
        }
      }
      rows.sort((a, b) => a.at - b.at);
      return { start, rows, plannedMin };
    });
  }, [tasks, fixedEvents, now, tz]);

  if (loading) return <Skeleton className="h-96" />;

  const allBlocks = tasks.filter((t) => ['todo', 'scheduled', 'doing'].includes(t.status)).flatMap((t) => t.blocks);

  return (
    <div className="grid gap-4">
      <h1 className="text-lg font-semibold">Next 7 days</h1>
      <DeadlineRiskPanel tasks={tasks} blocks={allBlocks} risks={livePlan.risks} now={now} tz={tz} />

      {days.every((d) => d.rows.length === 0) ? (
        <Card>
          <EmptyState icon={<CalendarDays size={22} />} title="Nothing coming up">
            Add tasks with dates, like “dentist Friday 4pm”, and they’ll show up here.
          </EmptyState>
        </Card>
      ) : (
        days.map((day) => (
          <section key={day.start} aria-label={formatDayLabel(day.start, tz, now)}>
            <div className="mb-1.5 flex items-baseline justify-between">
              <h2 className="text-sm font-semibold">{formatDayLabel(day.start, tz, now)}</h2>
              {day.plannedMin > 0 && (
                <span className="text-xs text-slate-600 dark:text-slate-400">{formatDuration(day.plannedMin)} planned</span>
              )}
            </div>
            {day.rows.length === 0 ? (
              <p className="rounded-xl border border-dashed border-slate-300 px-3 py-2 text-sm text-slate-600 dark:border-slate-700 dark:text-slate-400">
                Nothing planned
              </p>
            ) : (
              <ul className="grid gap-1.5">
                {day.rows.map((row) => (
                  <li key={row.key}>
                    <button
                      type="button"
                      disabled={!row.taskId}
                      onClick={() => row.taskId && select(row.taskId)}
                      className="flex w-full items-center gap-3 rounded-xl bg-white px-3 py-2 text-left text-sm shadow-sm hover:bg-slate-50 disabled:cursor-default dark:bg-slate-900 dark:hover:bg-slate-800"
                    >
                      {row.kind === 'deadline' ? <Flag size={15} className="shrink-0 text-red-700 dark:text-red-300" /> : row.kind === 'fixed' ? <Lock size={14} className="shrink-0 text-slate-500" /> : <span className="h-2 w-2 shrink-0 rounded-full bg-teal-600" />}
                      <span className="min-w-0 flex-1 truncate font-medium">{row.label}</span>
                      <span className="shrink-0 text-xs text-slate-600 dark:text-slate-400">{row.detail}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))
      )}
    </div>
  );
}
