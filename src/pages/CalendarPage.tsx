import { useMemo, useState } from 'react';
import { Bento, Kicker, Skeleton } from '../components/ui';
import { DayList } from '../features/plan/DayList';
import { dayItems } from '../features/plan/dayItems';
import type { PlannerData } from '../hooks/useData';
import { applySuggestion } from '../lib/db/actions';
import { collectFixed } from '../lib/scheduler';
import { addDaysTz, DAY, endOfDayTz, formatDayLabel, formatDuration, formatTime, MIN, startOfDayTz } from '../lib/time/tz';
import { useUi } from '../store/ui';

const DAYS_SHOWN = 14;

/** Two weeks at a glance, one day at a time, plus every upcoming deadline. */
export default function CalendarPage({ data }: { data: PlannerData }) {
  const { tasks, fixedEvents, profile, now, livePlan, loading } = data;
  const tz = profile.timezone;
  const toast = useUi((s) => s.toast);
  const select = useUi((s) => s.select);
  const [offset, setOffset] = useState(0);

  const first = startOfDayTz(now, tz);
  const fixed = useMemo(() => collectFixed({ tasks, fixedEvents }), [tasks, fixedEvents]);
  const days = useMemo(
    () =>
      Array.from({ length: DAYS_SHOWN }, (_, i) => {
        const start = addDaysTz(first, i, tz);
        const end = endOfDayTz(start, tz);
        const items = dayItems(tasks, fixed, start, end + 1);
        return { i, start, end, items, minutes: items.filter((x) => x.kind === 'block').reduce((s, x) => s + (x.end - x.start) / MIN, 0) };
      }),
    [first, tz, tasks, fixed],
  );
  const day = days[offset];

  const deadlines = tasks
    .filter((t) => ['todo', 'scheduled', 'doing'].includes(t.status) && t.dueAt !== undefined && t.dueAt < now + 21 * DAY)
    .sort((a, b) => (a.dueAt as number) - (b.dueAt as number));
  const atRisk = deadlines.filter((t) => livePlan.risks.some((r) => r.taskId === t.id)).length;

  if (loading) return <Skeleton className="h-96" />;

  const weekday = (ts: number) => new Intl.DateTimeFormat('en-GB', { weekday: 'short', timeZone: tz }).format(ts);
  const dateNum = (ts: number) => new Intl.DateTimeFormat('en-GB', { day: 'numeric', timeZone: tz }).format(ts);
  const monthLabel = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric', timeZone: tz }).format(day.start);

  return (
    <div className="grid gap-5">
      <header>
        <p className="text-lg font-semibold text-muted">{monthLabel}</p>
        <h1 className="text-3xl font-bold">Calendar</h1>
      </header>

      <div role="tablist" aria-label="Days" className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
        {days.map((d) => {
          const selected = d.i === offset;
          return (
            <button
              key={d.i}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-label={`${formatDayLabel(d.start, tz, now)}, ${d.items.length} items`}
              onClick={() => setOffset(d.i)}
              className={`flex h-20 w-14 shrink-0 flex-col items-center justify-center gap-0.5 rounded-[20px] transition ${
                selected ? 'bg-ink text-white dark:bg-white dark:text-ink' : 'bg-surface text-fg hover:brightness-95'
              }`}
            >
              <span className="text-xs font-semibold opacity-70">{d.i === 0 ? 'Today' : weekday(d.start)}</span>
              <span className="text-xl font-bold">{dateNum(d.start)}</span>
              <span className={`h-1.5 w-1.5 rounded-full ${d.items.length ? (selected ? 'bg-card-lime' : 'bg-fg/50') : 'bg-transparent'}`} aria-hidden />
            </button>
          );
        })}
      </div>

      <div className="grid gap-5 lg:grid-cols-[1.1fr_1fr] lg:items-start">
        <section aria-label={formatDayLabel(day.start, tz, now)}>
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="text-xl font-bold">{formatDayLabel(day.start, tz, now)}</h2>
            {day.minutes > 0 && <span className="text-sm font-semibold text-muted">{formatDuration(day.minutes)} planned</span>}
          </div>
          {day.items.length ? (
            <DayList items={day.items} tz={tz} now={now} />
          ) : (
            <div className="rounded-[24px] border-2 border-dashed border-line p-8 text-center">
              <p className="font-bold">A free day</p>
              <p className="mt-1 text-sm text-muted">Nothing planned yet.</p>
            </div>
          )}
        </section>

        <Bento tone="sky" className="grid gap-4">
          <div>
            <Kicker>Deadlines</Kicker>
            <h2 className="text-2xl font-bold leading-tight">
              {deadlines.length === 0
                ? 'No deadlines coming up'
                : atRisk
                  ? `${atRisk} of ${deadlines.length} need attention`
                  : `${deadlines.length} coming up, all on track`}
            </h2>
          </div>
          {deadlines.length === 0 && <p className="text-sm font-semibold opacity-75">Try adding “report due Friday”.</p>}
          <ul className="grid gap-2">
            {deadlines.map((task) => {
              const risk = livePlan.risks.find((r) => r.taskId === task.id);
              const due = task.dueAt as number;
              const endOfDay = due % 60_000 === 59_999;
              const status = risk?.kind === 'overdue' ? 'Overdue' : risk ? 'At risk' : 'On track';
              return (
                <li key={task.id} className="rounded-[22px] bg-white/70 p-3">
                  <div className="flex items-center gap-3">
                    <div className="flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-2xl bg-ink leading-none text-white">
                      <span className="text-base font-bold">{dateNum(due)}</span>
                      <span className="mt-0.5 text-[10px] font-bold opacity-80">{weekday(due)}</span>
                    </div>
                    <button type="button" onClick={() => select(task.id)} className="min-w-0 flex-1 text-left">
                      <span className="block truncate font-bold">{task.title}</span>
                      <span className="block text-sm font-semibold opacity-70">Due {formatDayLabel(due, tz, now).toLowerCase()}{endOfDay ? '' : ` at ${formatTime(due, tz)}`}</span>
                    </button>
                    <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-bold ${risk ? 'bg-card-coral' : 'bg-card-lime'}`}>{status}</span>
                  </div>
                  {risk?.kind === 'miss' && (
                    <div className="mt-3 grid gap-2">
                      <p className="text-sm font-semibold">{risk.message}</p>
                      <div className="flex flex-wrap gap-2">
                        {risk.suggestions.map((s, i) =>
                          s.taskId && s.action !== 'extend' ? (
                            <button
                              key={i}
                              type="button"
                              className="rounded-full bg-ink px-3.5 py-2 text-xs font-bold text-white"
                              onClick={async () => {
                                const undo = await applySuggestion(s.taskId as string, s.action as 'move' | 'drop', s.startAfter);
                                toast('Plan updated.', { undo });
                              }}
                            >
                              {s.text}
                            </button>
                          ) : (
                            <span key={i} className="text-xs font-semibold opacity-75">
                              {s.text}
                            </span>
                          ),
                        )}
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </Bento>
      </div>
    </div>
  );
}
