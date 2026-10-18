import { CalendarCheck, ChevronLeft, ChevronRight, Clock4, Sparkles, TriangleAlert } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, Card, EmptyState, Skeleton } from '../components/ui';
import { DayTimeline } from '../features/timeline/DayTimeline';
import { MorningScreen } from '../features/morning/MorningScreen';
import type { PlannerData } from '../hooks/useData';
import { replanAll } from '../lib/db/actions';
import { collectFixed } from '../lib/scheduler';
import { addDaysTz, endOfDayTz, formatDayLabel, formatDuration, isSameDayTz, startOfDayTz } from '../lib/time/tz';
import { useUi } from '../store/ui';

const EXAMPLES = [
  'Physics assignment due Thursday, about 2 hours, high priority',
  'Gym at 6pm, call mom, client meeting tomorrow 3 to 4',
  'Dentist Friday 4pm add to my calendar',
];

export function TodayPage({ data }: { data: PlannerData }) {
  const { tasks, fixedEvents, profile, now, livePlan, loading } = data;
  const tz = profile.timezone;
  const [offset, setOffset] = useState(0);
  const toast = useUi((s) => s.toast);
  const select = useUi((s) => s.select);
  const prefill = useUi((s) => s.prefill);

  const todayStart = startOfDayTz(now, tz);
  const day = addDaysTz(todayStart, offset, tz);
  const isToday = offset === 0;

  const active = useMemo(() => tasks.filter((t) => ['todo', 'scheduled', 'doing'].includes(t.status)), [tasks]);
  const fixedItems = useMemo(() => collectFixed({ tasks, fixedEvents }), [tasks, fixedEvents]);

  // blocks left over from an earlier day get re-planned into today as soon as the app opens
  const hasStale = active.some((t) => t.blocks.some((b) => b.end <= todayStart));
  useEffect(() => {
    if (hasStale) void replanAll();
  }, [hasStale]);

  const missedCount = active.flatMap((t) => t.blocks).filter((b) => b.end <= now && b.end > todayStart).length;
  const doneToday = tasks.filter((t) => t.status === 'done' && t.completedAt && isSameDayTz(t.completedAt, now, tz));
  const risks = livePlan.risks.slice(0, 2);

  if (loading) {
    return (
      <div className="grid gap-3" aria-busy="true" aria-label="Loading your day">
        <Skeleton className="h-24" />
        <Skeleton className="h-96" />
      </div>
    );
  }

  if (tasks.length === 0) {
    return (
      <EmptyState icon={<Sparkles size={22} />} title="Your day is a blank page">
        <p>Type or say what’s on your mind below. Dayflow will find the time, and re-plan when things slip.</p>
        <div className="mt-4 grid gap-2 text-left">
          {EXAMPLES.map((example) => (
            <button
              key={example}
              type="button"
              onClick={() => prefill(example)}
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm hover:border-teal-600 dark:border-slate-700 dark:bg-slate-900"
            >
              “{example}”
            </button>
          ))}
        </div>
      </EmptyState>
    );
  }

  const dayBlocks = active.flatMap((t) => t.blocks).filter((b) => b.start < endOfDayTz(day, tz) && b.end > day);
  const dayFixed = fixedItems.filter((f) => f.start < endOfDayTz(day, tz) && f.end > day);

  return (
    <div>
      {isToday && <MorningScreen data={data} />}

      {isToday && missedCount > 0 && (
        <Card className="mb-4 !border-amber-300 !bg-amber-50 dark:!border-amber-700 dark:!bg-amber-900/20">
          <div className="flex flex-wrap items-center gap-3">
            <Clock4 size={18} className="text-amber-800 dark:text-amber-200" />
            <p className="flex-1 text-sm font-medium text-amber-950 dark:text-amber-100">
              {missedCount} planned {missedCount === 1 ? 'block has' : 'blocks have'} passed. Want to re-pack the rest of your day?
            </p>
            <Button
              size="sm"
              variant="primary"
              onClick={async () => {
                const { plan } = await replanAll();
                toast(plan.risks.some((r) => r.kind === 'miss') ? 'Re-planned. Some deadlines are at risk.' : 'Re-planned from now.');
              }}
            >
              I’m behind: re-plan
            </Button>
          </div>
        </Card>
      )}

      {isToday &&
        risks.map((r) => (
          <button
            key={r.taskId}
            type="button"
            onClick={() => select(r.taskId)}
            className="mb-3 flex w-full items-start gap-2 rounded-xl bg-red-50 p-3 text-left text-sm text-red-950 dark:bg-red-900/20 dark:text-red-100"
          >
            <TriangleAlert size={16} className="mt-0.5 shrink-0" />
            <span>
              {r.message} <Link to="/upcoming" className="font-medium underline" onClick={(e) => e.stopPropagation()}>See options</Link>
            </span>
          </button>
        ))}

      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label="Previous day"
            onClick={() => setOffset(offset - 1)}
            className="rounded-lg p-2 hover:bg-slate-200/70 dark:hover:bg-slate-800"
          >
            <ChevronLeft size={18} />
          </button>
          <h1 className="min-w-28 text-center text-lg font-semibold">{formatDayLabel(day, tz, now)}</h1>
          <button
            type="button"
            aria-label="Next day"
            onClick={() => setOffset(offset + 1)}
            className="rounded-lg p-2 hover:bg-slate-200/70 dark:hover:bg-slate-800"
          >
            <ChevronRight size={18} />
          </button>
          {!isToday && (
            <Button size="sm" variant="ghost" onClick={() => setOffset(0)}>
              Today
            </Button>
          )}
        </div>
        {isToday && (
          <Button
            size="sm"
            onClick={async () => {
              const result = await replanAll({ lateMinutes: 30 });
              toast(`Pushed everything back 30 min.${result.plan.risks.length ? ' Check your deadlines.' : ''}`);
            }}
            title="Shift the rest of the day by 30 minutes"
          >
            I’m 30 min late
          </Button>
        )}
      </div>

      {dayBlocks.length === 0 && dayFixed.length === 0 ? (
        <Card>
          <EmptyState icon={<CalendarCheck size={22} />} title={isToday ? 'Nothing left to do today' : 'A free day'}>
            {isToday ? 'Enjoy the space, or add something below.' : 'Nothing is planned for this day yet.'}
          </EmptyState>
        </Card>
      ) : (
        <Card className="overflow-hidden !p-3 pb-4">
          <DayTimeline day={day} tasks={tasks} fixedItems={fixedItems} profile={profile} now={now} />
        </Card>
      )}

      {isToday && doneToday.length > 0 && (
        <section className="mt-6" aria-label="Completed today">
          <h2 className="mb-2 text-sm font-semibold text-slate-700 dark:text-slate-300">
            Completed today · {doneToday.length}
          </h2>
          <ul className="grid gap-1.5">
            {doneToday.map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  onClick={() => select(t.id)}
                  className="flex w-full items-center justify-between gap-2 rounded-xl bg-white px-3 py-2 text-left text-sm text-slate-600 line-through hover:bg-slate-100 dark:bg-slate-900 dark:text-slate-400 dark:hover:bg-slate-800"
                >
                  <span className="truncate">{t.title}</span>
                  {t.spentMin > 0 && <span className="no-underline">{formatDuration(t.spentMin)}</span>}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
