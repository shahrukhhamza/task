import { useLiveQuery } from 'dexie-react-hooks';
import { ChevronDown, Flame, Lightbulb, Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { habitStreak, isScheduledOn, weekReport, type HistoryInput } from '../../supabase/functions/_shared/analytics.ts';
import { addDays, dayBounds, hourLabel, localParts, shortDayLabel } from '../../supabase/functions/_shared/zone.ts';
import { Sheet } from '../components/Sheet';
import { Bento, Kicker, Segmented, Skeleton } from '../components/ui';
import { HabitCheck } from '../features/habits/HabitCheck';
import { HabitEditor } from '../features/habits/HabitEditor';
import { ChartCard, minutesTick, PairedBars, PairedLines, SingleBars } from '../features/report/charts';
import type { PlannerData } from '../hooks/useData';
import { db } from '../lib/db/schema';
import { describeDays } from '../lib/habits';
import { dayKey, formatDuration } from '../lib/time/tz';
import type { Habit } from '../lib/types';

const pill = 'inline-flex items-center rounded-full bg-white px-4 py-2 text-sm font-semibold text-ink';

function headline(score: number | null): { title: string; mood: string } {
  if (score === null) return { title: 'let’s get your first week going', mood: 'Plan a few tasks and finish them to see your progress' };
  if (score >= 80) return { title: 'you’re on a roll this week', mood: 'You are doing great 🎉' };
  if (score >= 60) return { title: 'your week is going well', mood: 'You are doing well 🙂' };
  if (score >= 40) return { title: 'steady progress this week', mood: 'Keep going, you’re getting there' };
  return { title: 'a lighter plan might help', mood: 'Smaller plans are easier to finish' };
}

/** How the week went, habits, and "where did my time go". */
export default function ProgressPage({ data }: { data: PlannerData }) {
  const { tasks, fixedEvents, checkins, habits, habitLogs, profile, now, loading } = data;
  const events = useLiveQuery(() => db.taskEvents.toArray(), []);
  const [week, setWeek] = useState<'this' | 'last'>('this');
  const [editing, setEditing] = useState<Habit | 'new' | null>(null);
  const [more, setMore] = useState(false);
  const tz = profile.timezone;
  const today = dayKey(now, tz);
  const end = week === 'this' ? today : addDays(today, -7);

  const report = useMemo(() => {
    if (!events) return null;
    const input: HistoryInput = { tasks, events, fixed: fixedEvents, checkins, habits, habitLogs, timezone: tz, peakStart: profile.peakStart, peakEnd: profile.peakEnd };
    const w = weekReport(input, end, now);
    const from = dayBounds(w.start, tz).start;
    const to = dayBounds(end, tz).end;
    const inWeek = (ts?: number) => ts !== undefined && ts >= from && ts < to;

    const byCat = new Map<string, { planned: number; actual: number }>();
    for (const t of tasks) {
      if (t.status !== 'done' || !inWeek(t.completedAt) || t.spentMin <= 0) continue;
      const row = byCat.get(t.category) ?? { planned: 0, actual: 0 };
      row.planned += t.estimateMin;
      row.actual += t.spentMin;
      byCat.set(t.category, row);
    }
    const estimates = [...byCat].map(([category, v]) => ({ category, ...v })).sort((a, b) => b.actual - a.actual).slice(0, 6);

    const byHour = new Map<number, number>();
    for (const e of events) {
      if (e.type !== 'focus' || !e.durationMin || !inWeek(e.at)) continue;
      const hour = localParts(e.at - e.durationMin * 60_000, tz).hour;
      byHour.set(hour, (byHour.get(hour) ?? 0) + e.durationMin);
    }
    const used = [...byHour.keys()];
    const first = Math.min(7, ...used);
    const last = Math.max(20, ...used);
    const rhythm = used.length ? Array.from({ length: last - first + 1 }, (_, i) => ({ hour: hourLabel(first + i), minutes: byHour.get(first + i) ?? 0 })) : [];

    const moodDays = Array.from({ length: 14 }, (_, i) => addDays(end, i - 13)).map((date) => {
      const c = checkins.find((x) => x.date === date);
      return { day: `${shortDayLabel(date)} ${Number(date.slice(8))}`, mood: c?.mood ?? null, energy: c?.energy ?? null };
    });
    return { w, estimates, rhythm, moodDays, hasMood: moodDays.some((d) => d.mood !== null) };
  }, [events, tasks, fixedEvents, checkins, habits, habitLogs, tz, profile.peakStart, profile.peakEnd, end, now]);

  const doneToday = useMemo(() => new Set(habitLogs.filter((l) => l.date === today).map((l) => l.habitId)), [habitLogs, today]);

  if (loading || !report) return <Skeleton className="h-96" />;
  const { w } = report;
  const words = headline(w.averageScore);
  const delta = w.averageScore !== null && w.previousAverageScore !== null ? w.averageScore - w.previousAverageScore : null;
  const scoreRows = w.days.map((d) => ({ ...d, scoreValue: d.score ?? 0 }));
  const categoryRows = w.categories.slice(0, 7).map((c) => ({ ...c, label: c.category.charAt(0).toUpperCase() + c.category.slice(1) }));

  return (
    <div className="grid gap-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <Bento tone="mist" className="rise p-6">
          <Kicker>{week === 'this' ? 'This week' : 'Last week'}</Kicker>
          <h1 className="mt-2 text-[32px] font-bold leading-[1.1] tracking-tight">Hello 👋 {words.title}</h1>
          <div className="mt-6 flex flex-wrap gap-2">
            <span className={pill}>Focus {w.focusMin ? formatDuration(w.focusMin) : '0m'}</span>
            {w.bestDay && <span className={pill}>Best: {w.bestDay.label.split(',')[0]} {w.bestDay.score}%</span>}
            {delta !== null && (
              <span className={pill}>
                {delta >= 0 ? '+' : '−'}
                {Math.abs(delta)} pts vs week before
              </span>
            )}
          </div>
        </Bento>

        <Bento tone="sun" className="rise flex flex-col p-6">
          <div className="flex items-center justify-between gap-2">
            <Kicker>Your progress</Kicker>
            <Segmented
              label="Week"
              value={week}
              onChange={setWeek}
              options={[
                { value: 'this', label: 'This week' },
                { value: 'last', label: 'Last week' },
              ]}
            />
          </div>
          <div className="mt-auto flex items-end justify-between gap-4 pt-8">
            <p className="max-w-[60%] text-2xl font-bold leading-tight">{words.mood}</p>
            <p className="text-6xl font-bold tracking-tight">{w.averageScore === null ? <span aria-label="no score yet">🌱</span> : `${w.averageScore}%`}</p>
          </div>
          <p className="mt-2 text-sm font-semibold opacity-70">
            {w.completed} of {w.planned} planned tasks done
          </p>
        </Bento>
      </div>

      <section id="habits" aria-label="Habits" className="rounded-[28px] bg-surface p-5">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-bold">Habits</h2>
          <button type="button" onClick={() => setEditing('new')} className="inline-flex items-center gap-1.5 rounded-full bg-fg px-4 py-2 text-sm font-bold text-app">
            <Plus size={16} /> New habit
          </button>
        </div>
        {habits.length === 0 ? (
          <p className="rounded-[20px] bg-surface-2 p-5 text-sm text-muted">
            Small things you want to do regularly: reading, a walk, journaling. Tap “New habit” to start a streak.
          </p>
        ) : (
          <ul className="grid gap-2">
            {habits.map((habit) => {
              const streak = habitStreak(habit, habitLogs, today);
              const scheduled = isScheduledOn(habit, today);
              const weekDays = Array.from({ length: 7 }, (_, i) => addDays(today, i - 6));
              return (
                <li key={habit.id} className="flex items-center gap-3 rounded-[22px] bg-surface-2 p-2 pr-4">
                  {scheduled ? (
                    <HabitCheck habitId={habit.id} title={habit.title} date={today} done={doneToday.has(habit.id)} />
                  ) : (
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-xs font-bold text-muted" title="Rest day">
                      rest
                    </span>
                  )}
                  <button type="button" onClick={() => setEditing(habit)} className="min-w-0 flex-1 text-left">
                    <span className="block truncate font-bold">{habit.title}</span>
                    <span className="block text-xs font-semibold text-muted">{describeDays(habit.days)}</span>
                  </button>
                  <div className="hidden gap-1 sm:flex" aria-label="Last 7 days">
                    {weekDays.map((date) => {
                      const done = habitLogs.some((l) => l.habitId === habit.id && l.date === date);
                      const due = isScheduledOn(habit, date);
                      return <span key={date} title={date} className={`h-2.5 w-2.5 rounded-full ${done ? 'bg-card-lime' : due ? 'bg-fg/20' : 'bg-transparent ring-1 ring-fg/15'}`} />;
                    })}
                  </div>
                  <span className="inline-flex w-12 items-center justify-end gap-0.5 font-bold text-orange-600 dark:text-orange-300" title={`Best streak: ${streak.best}`}>
                    <Flame size={16} aria-hidden /> {streak.current}
                    <span className="sr-only"> day streak, best {streak.best}</span>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <Bento tone="sky" className="flex gap-3">
        <Lightbulb size={22} className="mt-0.5 shrink-0" />
        <div>
          <Kicker>Insight</Kicker>
          <p className="mt-0.5 font-semibold">{w.insight}</p>
        </div>
      </Bento>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard
          title="Day score"
          subtitle="How much of each day’s plan got done"
          rows={w.days.some((d) => d.score !== null) ? scoreRows : []}
          columns={[
            { label: 'Day', value: (r) => r.label },
            { label: 'Score', value: (r) => (r.score === null ? 'nothing planned' : `${r.score}%`) },
            { label: 'Done', value: (r) => `${r.completed}/${r.planned}` },
          ]}
          empty="Plan and finish a few tasks to see your daily scores."
        >
          <SingleBars data={scoreRows} x="label" y="scoreValue" name="Day score" format={(v) => `${v}%`} max={100} />
        </ChartCard>

        <ChartCard
          title="Where your time went"
          subtitle={w.focusMin ? 'Focus time by category' : 'Finished tasks by category'}
          rows={categoryRows}
          columns={[
            { label: 'Category', value: (r) => r.label },
            { label: 'Time', value: (r) => formatDuration(r.minutes) },
          ]}
          empty="Finish tasks or use the focus timer to see this."
        >
          <SingleBars data={categoryRows} x="label" y="minutes" name="Time" format={minutesTick} layout="horizontal" />
        </ChartCard>
      </div>

      <button
        type="button"
        aria-expanded={more}
        onClick={() => setMore(!more)}
        className="mx-auto inline-flex items-center gap-1.5 rounded-full bg-surface px-5 py-2.5 text-sm font-bold"
      >
        {more ? 'Fewer charts' : 'More charts'} <ChevronDown size={16} className={`transition ${more ? 'rotate-180' : ''}`} />
      </button>

      {more && (
        <div className="grid gap-4 lg:grid-cols-2">
          <ChartCard
            title="Planned vs actual"
            subtitle="Your estimates against real focus time"
            rows={report.estimates}
            columns={[
              { label: 'Category', value: (r) => r.category },
              { label: 'Planned', value: (r) => formatDuration(r.planned) },
              { label: 'Actual', value: (r) => formatDuration(r.actual) },
            ]}
            empty="Use the focus timer on a few tasks to compare estimates with reality."
          >
            <PairedBars data={report.estimates} x="category" a={{ key: 'planned', name: 'Planned' }} b={{ key: 'actual', name: 'Actual' }} format={minutesTick} />
          </ChartCard>

          <ChartCard
            title="Your focus rhythm"
            subtitle="Focus minutes by hour of day"
            rows={report.rhythm}
            columns={[
              { label: 'Hour', value: (r) => r.hour },
              { label: 'Focus', value: (r) => formatDuration(r.minutes) },
            ]}
            empty="The focus timer will show which hours you do your best work."
          >
            <SingleBars data={report.rhythm} x="hour" y="minutes" name="Focus" format={minutesTick} />
          </ChartCard>

          <ChartCard
            title="Mood and energy"
            subtitle="Evening check-ins over two weeks (1 to 5)"
            rows={report.hasMood ? report.moodDays : []}
            columns={[
              { label: 'Day', value: (r) => r.day },
              { label: 'Mood', value: (r) => (r.mood === null ? '–' : String(r.mood)) },
              { label: 'Energy', value: (r) => (r.energy === null ? '–' : String(r.energy)) },
            ]}
            empty="Do the evening check-in on Today to track mood and energy."
          >
            <PairedLines data={report.moodDays} x="day" a={{ key: 'mood', name: 'Mood' }} b={{ key: 'energy', name: 'Energy' }} />
          </ChartCard>
        </div>
      )}

      <Sheet open={editing !== null} onClose={() => setEditing(null)} title={editing === 'new' ? 'New habit' : 'Edit habit'}>
        {editing !== null && <HabitEditor habit={editing} onClose={() => setEditing(null)} />}
      </Sheet>
    </div>
  );
}
