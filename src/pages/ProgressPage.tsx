import { useLiveQuery } from 'dexie-react-hooks';
import { ChevronDown, Flame, Lightbulb, Loader2, Plus, Repeat, Sparkles } from 'lucide-react';
import { useMemo, useState } from 'react';
import { habitStreak, isScheduledOn, weekReport, type HistoryInput } from '../../supabase/functions/_shared/analytics.ts';
import { addDays, dayBounds, hourLabel, localParts, shortDayLabel } from '../../supabase/functions/_shared/zone.ts';
import { Sheet } from '../components/Sheet';
import { Button, Segmented, Skeleton } from '../components/ui';
import { HabitCheck } from '../features/habits/HabitCheck';
import { HabitEditor } from '../features/habits/HabitEditor';
import { ChartCard, minutesTick, PairedBars, PairedLines, SingleBars } from '../features/report/charts';
import type { PlannerData } from '../hooks/useData';
import { useAiAvailable, weeklyInsights } from '../lib/ai/assistant';
import { AI_ERROR_TEXT, AiError } from '../../supabase/functions/_shared/gemini.ts';
import { db } from '../lib/db/schema';
import { describeDays } from '../lib/habits';
import { dayKey, formatDuration } from '../lib/time/tz';
import type { Habit } from '../lib/types';

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
  const ai = useAiAvailable();
  const [deeper, setDeeper] = useState<{ week: string; items: string[] } | null>(() => {
    try {
      return JSON.parse(localStorage.getItem('dayflow-week-look') ?? 'null');
    } catch {
      return null;
    }
  });
  const [deeperLoading, setDeeperLoading] = useState(false);
  const [deeperError, setDeeperError] = useState<string | null>(null);
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

  const lookKey = `${w.start}:${w.end}`;
  const askDeeper = async () => {
    setDeeperLoading(true);
    setDeeperError(null);
    try {
      const summary = [
        `Week ${w.start} to ${w.end}. Average day score ${w.averageScore ?? 'n/a'}% (previous week ${w.previousAverageScore ?? 'n/a'}%).`,
        `Tasks done ${w.completed} of ${w.planned}. Focus time ${w.focusMin} min (previous week ${w.previousFocusMin} min).`,
        `Days: ${w.days.map((d) => `${d.label} ${d.score === null ? 'no plan' : `${d.score}% (${d.completed}/${d.planned})`}`).join(', ')}.`,
        w.categories.length ? `Time by category: ${w.categories.map((c) => `${c.category} ${c.minutes} min`).join(', ')}.` : '',
        report.estimates.length ? `Planned vs actual: ${report.estimates.map((e) => `${e.category} ${e.planned}→${e.actual} min`).join(', ')}.` : '',
        w.habits.length ? `Habits: ${w.habits.map((h) => `${h.title} ${h.done}/${h.scheduled}`).join(', ')}.` : '',
        w.mood !== null ? `Average mood ${w.mood.toFixed(1)}/5, energy ${w.energy?.toFixed(1)}/5.` : '',
        `Best focus window ${Math.floor(profile.peakStart / 60)}:00–${Math.floor(profile.peakEnd / 60)}:00.`,
      ]
        .filter(Boolean)
        .join('\n');
      const items = await weeklyInsights(summary);
      const next = { week: lookKey, items };
      setDeeper(next);
      try {
        localStorage.setItem('dayflow-week-look', JSON.stringify(next));
      } catch {
        /* fine */
      }
    } catch (err) {
      setDeeperError(err instanceof AiError ? AI_ERROR_TEXT[err.code] : 'Couldn’t get a deeper look right now.');
    } finally {
      setDeeperLoading(false);
    }
  };
  const look = deeper?.week === lookKey ? deeper.items : null;

  return (
    <div className="grid gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-muted">{week === 'this' ? 'Last 7 days' : 'The 7 days before'}</p>
          <h1 className="mt-1 text-[32px] font-semibold leading-none tracking-tight lg:text-[38px]">Progress</h1>
        </div>
        <Segmented
          label="Week"
          value={week}
          onChange={setWeek}
          options={[
            { value: 'this', label: 'This week' },
            { value: 'last', label: 'Last week' },
          ]}
        />
      </header>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
        <div className="tint col-span-2 rounded-[24px] bg-card-lime p-5 text-ink lg:col-span-1">
          <p className="text-sm font-medium opacity-70">Average day score</p>
          <p className="mt-2 text-5xl font-semibold tracking-tight">{w.averageScore === null ? '—' : `${w.averageScore}%`}</p>
          <p className="mt-2 text-sm font-medium opacity-75">{words.mood}</p>
        </div>
        <Tile label="Tasks done" value={`${w.completed}/${w.planned}`} note={w.planned ? `${Math.round((w.completed / w.planned) * 100)}% of the plan` : 'Nothing planned yet'} />
        <Tile label="Focus time" value={w.focusMin ? formatDuration(w.focusMin) : '0m'} note={w.previousFocusMin ? `${formatDuration(w.previousFocusMin)} the week before` : 'Use the focus timer'} />
        <Tile
          label="Best day"
          value={w.bestDay ? w.bestDay.label.split(',')[0].slice(0, 3) : '—'}
          note={w.bestDay ? `${w.bestDay.score}% done${delta !== null ? ` · ${delta >= 0 ? '+' : '−'}${Math.abs(delta)} pts vs before` : ''}` : 'Finish a planned day'}
        />
      </div>

      <section aria-label="Insight" className="rounded-[24px] border border-line p-5">
        <div className="flex flex-wrap items-start gap-4">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-card-sky text-ink">
            <Lightbulb size={18} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-muted">Insight</p>
            <p className="mt-0.5 text-[16px] font-medium leading-snug">{w.insight}</p>
          </div>
          {ai && !look && (
            <button
              type="button"
              onClick={() => void askDeeper()}
              disabled={deeperLoading}
              className="inline-flex items-center gap-1.5 rounded-full border border-line px-4 py-2 text-sm font-medium hover:bg-surface-2 disabled:opacity-70"
            >
              {deeperLoading ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />} {deeperLoading ? 'Looking…' : 'Deeper look'}
            </button>
          )}
        </div>
        {deeperError && <p className="mt-3 text-sm text-muted">{deeperError}</p>}
        {look && (
          <ul className="mt-4 grid gap-2 border-t border-line pt-4 sm:grid-cols-3">
            {look.map((item, i) => (
              <li key={i} className="flex gap-2.5 rounded-2xl bg-surface-2 p-3.5 text-sm leading-relaxed">
                <Sparkles size={15} className="mt-0.5 shrink-0 text-muted" /> {item}
              </li>
            ))}
          </ul>
        )}
      </section>

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

      <section id="habits" aria-label="Habits" className="rounded-[24px] border border-line p-5">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Habits</h2>
            <p className="text-sm text-muted">{habits.length ? 'Tap the circle to check off today' : 'Small things you want to do regularly'}</p>
          </div>
          <Button size="sm" variant="primary" onClick={() => setEditing('new')}>
            <Plus size={15} /> New habit
          </Button>
        </div>
        {habits.length === 0 ? (
          <button
            type="button"
            onClick={() => setEditing('new')}
            className="flex w-full items-center gap-4 rounded-[18px] border border-dashed border-line p-5 text-left hover:bg-surface-2"
          >
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-card-lime text-ink">
              <Repeat size={19} />
            </span>
            <span className="text-sm text-muted">Reading, a walk, journaling… build a streak one day at a time.</span>
          </button>
        ) : (
          <ul className="grid gap-1">
            {habits.map((habit) => {
              const streak = habitStreak(habit, habitLogs, today);
              const scheduled = isScheduledOn(habit, today);
              const weekDays = Array.from({ length: 7 }, (_, i) => addDays(today, i - 6));
              return (
                <li key={habit.id} className="flex items-center gap-3 rounded-[18px] px-2 py-2 hover:bg-surface-2">
                  {scheduled ? (
                    <HabitCheck habitId={habit.id} title={habit.title} date={today} done={doneToday.has(habit.id)} size={36} />
                  ) : (
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[11px] font-medium text-muted" title="Rest day">
                      rest
                    </span>
                  )}
                  <button type="button" onClick={() => setEditing(habit)} className="min-w-0 flex-1 text-left">
                    <span className="block truncate font-medium">{habit.title}</span>
                    <span className="block text-xs text-muted">{describeDays(habit.days)}</span>
                  </button>
                  <div className="hidden gap-1 sm:flex" aria-label="Last 7 days">
                    {weekDays.map((date) => {
                      const done = habitLogs.some((l) => l.habitId === habit.id && l.date === date);
                      const due = isScheduledOn(habit, date);
                      return <span key={date} title={date} className={`h-2 w-2 rounded-full ${done ? 'bg-card-lime' : due ? 'bg-fg/15' : 'bg-transparent ring-1 ring-fg/15'}`} />;
                    })}
                  </div>
                  <span className="inline-flex w-12 items-center justify-end gap-0.5 text-sm font-semibold text-orange-600 dark:text-orange-300" title={`Best streak: ${streak.best}`}>
                    <Flame size={15} aria-hidden /> {streak.current}
                    <span className="sr-only"> day streak, best {streak.best}</span>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <button
        type="button"
        aria-expanded={more}
        onClick={() => setMore(!more)}
        className="mx-auto inline-flex items-center gap-1.5 rounded-full border border-line px-5 py-2 text-sm font-medium hover:bg-surface-2"
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

function Tile({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="min-w-0 rounded-[24px] border border-line p-5">
      <p className="truncate text-sm font-medium text-muted">{label}</p>
      <p className="mt-2 truncate text-3xl font-semibold tracking-tight">{value}</p>
      <p className="mt-2 truncate text-xs text-muted">{note}</p>
    </div>
  );
}
