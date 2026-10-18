import { useLiveQuery } from 'dexie-react-hooks';
import { ChevronLeft, ChevronRight, Lightbulb } from 'lucide-react';
import { useMemo, useState } from 'react';
import { weekReport, type HistoryInput } from '../../supabase/functions/_shared/analytics.ts';
import { addDays, dayBounds, hourLabel, localParts, shortDayLabel } from '../../supabase/functions/_shared/zone.ts';
import { Card, Skeleton } from '../components/ui';
import { ChartCard, minutesTick, PairedBars, PairedLines, SingleBars } from '../features/report/charts';
import type { PlannerData } from '../hooks/useData';
import { db } from '../lib/db/schema';
import { dayKey, formatDuration } from '../lib/time/tz';

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <Card className="!p-3">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-600 dark:text-slate-400">{label}</p>
      <p className="mt-1 text-2xl font-semibold">{value}</p>
      {note && <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-400">{note}</p>}
    </Card>
  );
}

function delta(now: number | null, before: number | null, unit: (n: number) => string): string | undefined {
  if (now === null || before === null) return undefined;
  const diff = now - before;
  if (Math.abs(diff) < 1) return 'same as last week';
  return `${diff > 0 ? '+' : '−'}${unit(Math.abs(diff))} vs last week`;
}

/** "Where did my time go": the week in numbers and charts. */
export function ReportPage({ data }: { data: PlannerData }) {
  const { tasks, fixedEvents, checkins, habits, habitLogs, profile, now, loading } = data;
  const events = useLiveQuery(() => db.taskEvents.toArray(), []);
  const [weeksBack, setWeeksBack] = useState(0);
  const tz = profile.timezone;
  const end = addDays(dayKey(now, tz), -7 * weeksBack);

  const report = useMemo(() => {
    if (!events) return null;
    const input: HistoryInput = { tasks, events, fixed: fixedEvents, checkins, habits, habitLogs, timezone: tz, peakStart: profile.peakStart, peakEnd: profile.peakEnd };
    const week = weekReport(input, end, now);
    const from = dayBounds(week.start, tz).start;
    const to = dayBounds(end, tz).end;
    const inWeek = (ts?: number) => ts !== undefined && ts >= from && ts < to;

    // planned vs actual, from finished tasks that were timed with the focus timer
    const byCat = new Map<string, { planned: number; actual: number }>();
    for (const t of tasks) {
      if (t.status !== 'done' || !inWeek(t.completedAt) || t.spentMin <= 0) continue;
      const row = byCat.get(t.category) ?? { planned: 0, actual: 0 };
      row.planned += t.estimateMin;
      row.actual += t.spentMin;
      byCat.set(t.category, row);
    }
    const estimates = [...byCat].map(([category, v]) => ({ category, ...v })).sort((a, b) => b.actual - a.actual).slice(0, 6);

    // focus minutes by hour of day
    const byHour = new Map<number, number>();
    for (const e of events) {
      if (e.type !== 'focus' || !e.durationMin || !inWeek(e.at)) continue;
      const hour = localParts(e.at - e.durationMin * 60_000, tz).hour;
      byHour.set(hour, (byHour.get(hour) ?? 0) + e.durationMin);
    }
    const hoursUsed = [...byHour.keys()];
    const first = Math.min(7, ...hoursUsed);
    const last = Math.max(20, ...hoursUsed);
    const rhythm = hoursUsed.length
      ? Array.from({ length: last - first + 1 }, (_, i) => ({ hour: hourLabel(first + i), minutes: byHour.get(first + i) ?? 0 }))
      : [];

    // mood and energy over two weeks
    const moodDays = Array.from({ length: 14 }, (_, i) => addDays(end, i - 13)).map((date) => {
      const c = checkins.find((x) => x.date === date);
      return { day: `${shortDayLabel(date)} ${Number(date.slice(8))}`, mood: c?.mood ?? null, energy: c?.energy ?? null };
    });

    return { week, estimates, rhythm, moodDays, hasMood: moodDays.some((d) => d.mood !== null) };
  }, [events, tasks, fixedEvents, checkins, habits, habitLogs, tz, profile.peakStart, profile.peakEnd, end, now]);

  if (loading || !report) return <Skeleton className="h-96" />;
  const { week } = report;
  const scoreRows = week.days.map((d) => ({ ...d, scoreValue: d.score ?? 0 }));
  const categoryRows = week.categories.slice(0, 7).map((c) => ({ ...c, label: c.category.charAt(0).toUpperCase() + c.category.slice(1) }));

  return (
    <div className="grid gap-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-lg font-semibold">Where did my time go?</h1>
        <div className="flex items-center gap-1">
          <button type="button" aria-label="Previous week" onClick={() => setWeeksBack(weeksBack + 1)} className="rounded-lg p-2 hover:bg-slate-200/70 dark:hover:bg-slate-800">
            <ChevronLeft size={18} />
          </button>
          <span className="min-w-36 text-center text-sm font-medium">
            {weeksBack === 0 ? 'Last 7 days' : `${week.start.slice(5)} → ${week.end.slice(5)}`}
          </span>
          <button
            type="button"
            aria-label="Next week"
            disabled={weeksBack === 0}
            onClick={() => setWeeksBack(weeksBack - 1)}
            className="rounded-lg p-2 hover:bg-slate-200/70 disabled:opacity-40 dark:hover:bg-slate-800"
          >
            <ChevronRight size={18} />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Tasks done" value={`${week.completed}/${week.planned}`} />
        <Stat label="Average day" value={week.averageScore === null ? '–' : `${week.averageScore}%`} note={delta(week.averageScore, week.previousAverageScore, (n) => `${Math.round(n)} pts`)} />
        <Stat label="Focus" value={week.focusMin ? formatDuration(week.focusMin) : '–'} note={week.previousFocusMin ? delta(week.focusMin, week.previousFocusMin, formatDuration) : undefined} />
        <Stat label="Best day" value={week.bestDay ? `${week.bestDay.label.split(',')[0].slice(0, 3)} ${week.bestDay.score}%` : '–'} />
      </div>

      <Card className="flex gap-3 !bg-teal-50 dark:!bg-teal-950/40">
        <Lightbulb size={20} className="mt-0.5 shrink-0 text-teal-800 dark:text-teal-300" />
        <p className="text-sm">{week.insight}</p>
      </Card>

      <ChartCard
        title="Day score"
        subtitle="Share of planned tasks finished each day"
        rows={week.days.some((d) => d.score !== null) ? scoreRows : []}
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
        title="Time by category"
        subtitle={week.focusMin ? 'Focus time logged with the timer' : 'Time of finished tasks'}
        rows={categoryRows}
        columns={[
          { label: 'Category', value: (r) => r.label },
          { label: 'Time', value: (r) => formatDuration(r.minutes) },
        ]}
        empty="Finish tasks or use the focus timer to see where your time goes."
      >
        <SingleBars data={categoryRows} x="label" y="minutes" name="Time" format={minutesTick} layout="horizontal" />
      </ChartCard>

      <ChartCard
        title="Planned vs actual"
        subtitle="Estimates against focus time, for timed tasks"
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
        empty="Do the evening check-in on the Today page to track mood and energy."
      >
        <PairedLines data={report.moodDays} x="day" a={{ key: 'mood', name: 'Mood' }} b={{ key: 'energy', name: 'Energy' }} />
      </ChartCard>

      {week.habits.length > 0 && (
        <Card>
          <h2 className="mb-2 font-semibold">Habits this week</h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-slate-600 dark:border-slate-700 dark:text-slate-400">
                <th className="py-1.5 font-medium">Habit</th>
                <th className="py-1.5 text-right font-medium">Done</th>
                <th className="py-1.5 text-right font-medium">Streak</th>
              </tr>
            </thead>
            <tbody>
              {week.habits.map((h) => (
                <tr key={h.title} className="border-b border-slate-100 dark:border-slate-800">
                  <td className="py-1.5">{h.title}</td>
                  <td className="py-1.5 text-right tabular-nums">
                    {h.done}/{h.scheduled}
                  </td>
                  <td className="py-1.5 text-right tabular-nums">{h.streak} days</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}

export default ReportPage;
