import { ArrowUpRight, CalendarDays, Check, Play, Plus, RefreshCw, Sparkles, TriangleAlert } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bento, DateBlock, IconButton, Kicker, Segmented, Skeleton } from '../components/ui';
import { ReconnectBanner } from '../features/account/ReconnectBanner';
import { EveningCheckin } from '../features/checkin/EveningCheckin';
import { TodayHabits } from '../features/habits/TodayHabits';
import { DayList } from '../features/plan/DayList';
import { dayItems } from '../features/plan/dayItems';
import { DayTimeline } from '../features/timeline/DayTimeline';
import type { PlannerData } from '../hooks/useData';
import { completeTask, replanAll } from '../lib/db/actions';
import { collectFixed, dayFeasibility, statsFromTasks } from '../lib/scheduler';
import { dayKey, endOfDayTz, formatDuration, formatTime, MIN, minutesOfDay, startOfDayTz } from '../lib/time/tz';
import { useCloud } from '../store/cloud';
import { useUi } from '../store/ui';

const VIEW_KEY = 'dayflow-today-view';

const greeting = (hour: number) => (hour < 5 ? 'Up late' : hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening');

function readView(): 'list' | 'timeline' {
  try {
    return localStorage.getItem(VIEW_KEY) === 'timeline' ? 'timeline' : 'list';
  } catch {
    return 'list';
  }
}

export function TodayPage({ data }: { data: PlannerData }) {
  const { tasks, fixedEvents, profile, now, livePlan, loading, habits, habitLogs, checkins } = data;
  const tz = profile.timezone;
  const toast = useUi((s) => s.toast);
  const select = useUi((s) => s.select);
  const openAdd = useUi((s) => s.openAdd);
  const startFocus = useUi((s) => s.startFocus);
  const user = useCloud((s) => s.user);
  const [view, setView] = useState<'list' | 'timeline'>(readView);

  const start = startOfDayTz(now, tz);
  const end = endOfDayTz(now, tz);
  const today = dayKey(now, tz);
  const hour = Math.floor(minutesOfDay(now, tz) / 60);

  const active = useMemo(() => tasks.filter((t) => ['todo', 'scheduled', 'doing'].includes(t.status)), [tasks]);
  const fixed = useMemo(() => collectFixed({ tasks, fixedEvents }), [tasks, fixedEvents]);
  const items = useMemo(() => dayItems(tasks, fixed, start, end + 1), [tasks, fixed, start, end]);

  // blocks left over from an earlier day get re-planned into today as soon as the app opens
  const hasStale = active.some((t) => t.blocks.some((b) => b.end <= start));
  useEffect(() => {
    if (hasStale) void replanAll();
  }, [hasStale]);

  const stats = useMemo(() => {
    const todayTaskIds = new Set(items.filter((i) => i.task && i.kind !== 'event').map((i) => i.task!.id));
    const doneToday = tasks.filter((t) => t.status === 'done' && (t.completedAt ?? 0) >= start);
    for (const t of doneToday) todayTaskIds.add(t.id);
    const remaining = [...todayTaskIds].filter((id) => !doneToday.some((t) => t.id === id)).length;
    const feasibility = dayFeasibility({ tasks, fixedEvents, profile, now, estimates: statsFromTasks(tasks) }, livePlan);
    const missed = items.filter((i) => i.kind === 'block' && i.end <= now).length;
    return { total: todayTaskIds.size, done: doneToday.length, remaining, feasibility, missed, doneTasks: doneToday };
  }, [items, tasks, fixedEvents, profile, now, livePlan, start]);

  const next = items.find((i) => i.end > now);
  const risk = livePlan.risks.find((r) => r.kind === 'miss') ?? livePlan.risks[0];

  if (loading) {
    return (
      <div className="grid gap-4" aria-busy="true" aria-label="Loading your day">
        <Skeleton className="h-16" />
        <Skeleton className="h-60" />
        <Skeleton className="h-28" />
      </div>
    );
  }

  const name = user?.name?.split(' ')[0];
  const dateLabel = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: tz }).format(now);
  const pct = stats.total ? Math.round((stats.done / stats.total) * 100) : 0;
  const nextTime = next ? formatTime(next.start, tz).split(' ') : [];

  return (
    <div>
      <header className="mb-5 flex items-center gap-3">
        <div>
          <p className="text-lg font-semibold text-muted">Hi{name ? ` ${name}` : ''} 👋</p>
          <p className="text-2xl font-bold">{greeting(hour)}</p>
        </div>
        <Link
          to="/settings"
          aria-label="Settings and account"
          className="ml-auto flex h-12 w-12 items-center justify-center overflow-hidden rounded-full bg-surface text-lg font-bold ring-2 ring-card-lime"
        >
          {user?.avatarUrl ? <img src={user.avatarUrl} alt="" className="h-full w-full object-cover" referrerPolicy="no-referrer" /> : name ? name[0] : <Sparkles size={20} />}
        </Link>
      </header>

      <ReconnectBanner />

      <div className="grid gap-4 lg:grid-cols-[1fr_1.05fr] lg:items-start lg:gap-6">
        <div className="grid gap-4">
          <Bento tone="lime" className="rise p-6">
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-2 rounded-full bg-white py-1.5 pl-1.5 pr-3.5 text-sm font-semibold">
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-card-mist">
                  <CalendarDays size={15} />
                </span>
                {dateLabel}
              </span>
              <div className="ml-auto flex gap-2">
                {stats.remaining > 0 && (
                  <IconButton
                    label="Re-plan the rest of today"
                    onClick={async () => {
                      const { plan } = await replanAll();
                      toast(plan.risks.some((r) => r.kind === 'miss') ? 'Re-planned. Some deadlines are tight.' : 'Re-planned from now.');
                    }}
                  >
                    <RefreshCw size={18} />
                  </IconButton>
                )}
                <IconButton label="Add a task" onClick={() => openAdd()}>
                  <Plus size={20} />
                </IconButton>
              </div>
            </div>

            <Kicker className="mt-8">Today’s plan</Kicker>
            {stats.total === 0 ? (
              <>
                <h1 className="mt-1 text-[32px] font-bold leading-[1.1] tracking-tight">Your day is wide open</h1>
                <button type="button" onClick={() => openAdd()} className="mt-5 inline-flex items-center gap-2 rounded-full bg-ink px-5 py-3 font-semibold text-white">
                  <Plus size={18} /> Add your first task
                </button>
              </>
            ) : stats.remaining === 0 ? (
              <h1 className="mt-1 text-[32px] font-bold leading-[1.1] tracking-tight">All done for today. Well played.</h1>
            ) : (
              <h1 className="mt-1 text-[32px] font-bold leading-[1.2] tracking-tight">
                You have {stats.remaining} {stats.remaining === 1 ? 'task' : 'tasks'}{' '}
                <span className="inline-flex -translate-y-1 items-center gap-1 rounded-full bg-white px-3 py-1 align-middle text-sm font-bold">
                  {stats.feasibility.canFinish ? (
                    <>
                      <Check size={14} strokeWidth={3} /> All fits
                    </>
                  ) : (
                    <>
                      <TriangleAlert size={14} /> {stats.feasibility.atRisk.length} at risk
                    </>
                  )}
                </span>{' '}
                for today
              </h1>
            )}

            {stats.total > 0 && (
              <div className="mt-6">
                <div
                  className="h-2 overflow-hidden rounded-full bg-white/60"
                  role="progressbar"
                  aria-valuenow={pct}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label="Tasks done today"
                >
                  <div className="h-full rounded-full bg-ink transition-all" style={{ width: `${pct}%` }} />
                </div>
                <p className="mt-2 text-sm font-semibold opacity-75">
                  {stats.done} of {stats.total} done
                </p>
              </div>
            )}
          </Bento>

          {stats.missed > 0 && stats.remaining > 0 && (
            <Bento tone="coral" className="rise flex items-center gap-3 !py-4">
              <div className="min-w-0 flex-1">
                <p className="font-bold">
                  {stats.missed} {stats.missed === 1 ? 'block' : 'blocks'} slipped by
                </p>
                <p className="text-sm font-semibold opacity-75">Re-plan the rest of today in one tap</p>
              </div>
              <IconButton
                label="Re-plan from now"
                onClick={async () => {
                  await replanAll();
                  toast('Re-planned from now.');
                }}
              >
                <RefreshCw size={18} />
              </IconButton>
            </Bento>
          )}

          {risk && stats.missed === 0 && (
            <Bento tone="sun" className="rise flex items-center gap-3 !py-4">
              <TriangleAlert size={20} className="shrink-0" />
              <p className="min-w-0 flex-1 text-sm font-semibold">{risk.message}</p>
              <Link to="/calendar" aria-label="See how to fix it" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-ink text-white">
                <ArrowUpRight size={18} />
              </Link>
            </Bento>
          )}

          {next && (
            <Bento tone="cream" className="rise flex items-center gap-4 !py-4">
              <DateBlock top={nextTime[0]} bottom={nextTime[1]} />
              <button type="button" disabled={!next.task} onClick={() => next.task && select(next.task.id)} className="min-w-0 flex-1 text-left">
                <p className="text-xs font-bold uppercase tracking-wide opacity-60">{next.start <= now ? 'Happening now' : 'Up next'}</p>
                <p className="truncate text-xl font-bold">{next.title}</p>
                <p className="text-sm font-semibold opacity-70">
                  {next.start <= now
                    ? `Until ${formatTime(next.end, tz)}`
                    : `In ${formatDuration(Math.max(1, Math.round((next.start - now) / MIN)))} · ${formatDuration((next.end - next.start) / MIN)}`}
                </p>
              </button>
              {next.task && next.kind === 'block' ? (
                <IconButton label={`Start focus on ${next.title}`} onClick={() => startFocus(next.task!.id)} size={48}>
                  <Play size={20} fill="currentColor" className="ml-0.5" />
                </IconButton>
              ) : next.task ? (
                <IconButton
                  label={`Mark ${next.title} done`}
                  size={48}
                  onClick={async () => {
                    const undo = await completeTask(next.task!.id);
                    toast(`Done: “${next.title}”.`, { undo });
                  }}
                >
                  <Check size={20} strokeWidth={3} />
                </IconButton>
              ) : null}
            </Bento>
          )}

          <TodayHabits habits={habits} logs={habitLogs} today={today} />
          <EveningCheckin key={today} date={today} existing={checkins.find((c) => c.date === today)} hour={hour} />
        </div>

        <section aria-label="Your day">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-xl font-bold">Your day</h2>
            {items.length > 0 && (
              <Segmented
                label="View"
                value={view}
                onChange={(v) => {
                  setView(v);
                  try {
                    localStorage.setItem(VIEW_KEY, v);
                  } catch {
                    /* remembered for this visit only */
                  }
                }}
                options={[
                  { value: 'list', label: 'List' },
                  { value: 'timeline', label: 'Timeline' },
                ]}
              />
            )}
          </div>

          {items.length === 0 ? (
            <div className="rounded-[24px] border-2 border-dashed border-line p-8 text-center">
              <p className="font-bold">Nothing scheduled today</p>
              <p className="mt-1 text-sm text-muted">Tap ＋ and type or say what you need to do.</p>
            </div>
          ) : view === 'list' ? (
            <DayList items={items} tz={tz} now={now} />
          ) : (
            <div className="rounded-[24px] bg-surface p-3">
              <DayTimeline day={now} tasks={tasks} fixedItems={fixed} profile={profile} now={now} />
            </div>
          )}

          {stats.doneTasks.length > 0 && (
            <div className="mt-5">
              <h3 className="mb-2 text-sm font-bold text-muted">Done today · {stats.doneTasks.length}</h3>
              <ul className="grid gap-2">
                {stats.doneTasks.map((t) => (
                  <li key={t.id}>
                    <button type="button" onClick={() => select(t.id)} className="flex w-full items-center gap-3 rounded-[20px] bg-surface/60 px-4 py-3 text-left">
                      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-card-lime text-ink">
                        <Check size={15} strokeWidth={3} />
                      </span>
                      <span className="flex-1 truncate font-semibold text-muted line-through">{t.title}</span>
                      {t.spentMin > 0 && <span className="text-sm text-muted">{formatDuration(t.spentMin)}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
