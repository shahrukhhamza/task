import { ArrowUpRight, Check, Play, Plus, RefreshCw, Sparkles, TriangleAlert } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bento, DateBlock, IconButton, Kicker, Segmented, Skeleton } from '../components/ui';
import { ReconnectBanner } from '../features/account/ReconnectBanner';
import { useDailyBrief } from '../features/ai/useDailyBrief';
import { EveningCheckin } from '../features/checkin/EveningCheckin';
import { TodayHabits } from '../features/habits/TodayHabits';
import { DayList } from '../features/plan/DayList';
import { dayItems } from '../features/plan/dayItems';
import { DayTimeline } from '../features/timeline/DayTimeline';
import type { PlannerData } from '../hooks/useData';
import type { DayContext } from '../lib/ai/assistant';
import { completeTask, replanAll } from '../lib/db/actions';
import { collectFixed, dayFeasibility, statsFromTasks } from '../lib/scheduler';
import { DAY, dayKey, endOfDayTz, formatDuration, formatTime, MIN, minutesOfDay, startOfDayTz } from '../lib/time/tz';
import { useCloud } from '../store/cloud';
import { useUi } from '../store/ui';

const VIEW_KEY = 'dayflow-today-view';

const greeting = (hour: number) => (hour < 5 ? 'Up late?' : hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening');

function readView(): 'list' | 'timeline' {
  try {
    return localStorage.getItem(VIEW_KEY) === 'timeline' ? 'timeline' : 'list';
  } catch {
    return 'list';
  }
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-[22px] bg-surface p-3 ring-1 ring-line sm:p-4">
      <p className="truncate text-xs font-medium text-muted">{label}</p>
      <p className="mt-1 truncate text-lg font-semibold tracking-tight sm:text-2xl">{value}</p>
    </div>
  );
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
    const plannedLeft = items.filter((i) => i.kind === 'block' && i.end > now).reduce((s, i) => s + (i.end - Math.max(i.start, now)) / MIN, 0);
    return {
      total: todayTaskIds.size,
      done: doneToday.length,
      remaining,
      feasibility,
      missed,
      doneTasks: doneToday,
      plannedLeft,
      free: Math.max(0, feasibility.availableMin - plannedLeft),
    };
  }, [items, tasks, fixedEvents, profile, now, livePlan, start]);

  const next = items.find((i) => i.end > now);
  const risk = livePlan.risks.find((r) => r.kind === 'miss') ?? livePlan.risks[0];

  const briefContext = useMemo<DayContext | null>(() => {
    const upcoming = items.filter((i) => i.end > now);
    if (!upcoming.length) return null;
    return {
      timezone: tz,
      now: Math.floor(now / (15 * MIN)) * 15 * MIN,
      items: upcoming.map((i) => ({ title: i.title, start: i.start, end: i.end, kind: i.kind, priority: i.task?.priority })),
      deadlines: active.filter((t) => t.dueAt !== undefined && t.dueAt < now + 3 * DAY).map((t) => ({ title: t.title, dueAt: t.dueAt as number })),
      habits: habits.map((h) => h.title),
      done: stats.done,
      peakStart: profile.peakStart,
      peakEnd: profile.peakEnd,
    };
    // the brief only needs to know when the plan itself changes, not every clock tick
  }, [items.map((i) => i.key).join(), stats.done, habits.length]);
  const brief = useDailyBrief(today, briefContext);

  if (loading) {
    return (
      <div className="grid gap-4" aria-busy="true" aria-label="Loading your day">
        <Skeleton className="h-16" />
        <Skeleton className="h-64" />
        <Skeleton className="h-28" />
      </div>
    );
  }

  const name = user?.name?.split(' ')[0];
  const longDate = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: tz }).format(now);
  const pct = stats.total ? Math.round((stats.done / stats.total) * 100) : 0;
  const nextTime = next ? formatTime(next.start, tz).split(' ') : [];

  return (
    <div>
      <header className="mb-6 flex items-end gap-3 lg:mb-8">
        <div>
          <p className="text-sm font-medium text-muted">{longDate}</p>
          <h1 className="mt-1 text-[32px] font-semibold leading-none tracking-tight lg:text-[40px]">
            {greeting(hour)}
            {name ? `, ${name}` : ''}
          </h1>
        </div>
        <Link
          to="/settings"
          aria-label="Settings and account"
          className="ml-auto flex h-12 w-12 items-center justify-center overflow-hidden rounded-full bg-surface text-lg font-semibold ring-2 ring-card-lime lg:hidden"
        >
          {user?.avatarUrl ? <img src={user.avatarUrl} alt="" className="h-full w-full object-cover" referrerPolicy="no-referrer" /> : name ? name[0] : <Sparkles size={20} />}
        </Link>
      </header>

      <ReconnectBanner />

      <div className="grid gap-5 lg:grid-cols-12 lg:items-start lg:gap-6">
        <div className="grid gap-5 lg:col-span-7">
          {/* hero */}
          <Bento tone="lime" className="rise relative overflow-hidden p-6 lg:p-8">
            <div aria-hidden className="absolute -right-16 -top-16 h-56 w-56 rounded-full border-[28px] border-ink/[0.06]" />
            <div aria-hidden className="absolute -bottom-24 right-24 h-40 w-40 rounded-full bg-white/25" />
            <div className="relative">
              <div className="flex items-start justify-between gap-3">
                <Kicker>Today’s plan</Kicker>
                <IconButton label="Add a task" onClick={() => openAdd()}>
                  <Plus size={20} />
                </IconButton>
              </div>

              {stats.total === 0 ? (
                <>
                  <h2 className="mt-3 max-w-md text-[34px] font-semibold leading-[1.05] tracking-tight lg:text-[44px]">Your day is wide open</h2>
                  <p className="mt-3 max-w-sm font-medium opacity-70">Tell Dayflow what’s on your mind and it will find the time.</p>
                  <button type="button" onClick={() => openAdd()} className="mt-6 inline-flex items-center gap-2 rounded-full bg-ink px-6 py-3.5 font-semibold text-white">
                    <Plus size={18} /> Add your first task
                  </button>
                </>
              ) : stats.remaining === 0 ? (
                <>
                  <h2 className="mt-3 text-[34px] font-semibold leading-[1.05] tracking-tight lg:text-[44px]">All done for today</h2>
                  <p className="mt-3 font-medium opacity-70">Well played. Enjoy the rest of your day.</p>
                </>
              ) : (
                <h2 className="mt-3 max-w-lg text-[34px] font-semibold leading-[1.12] tracking-tight lg:text-[44px]">
                  {stats.remaining} {stats.remaining === 1 ? 'thing' : 'things'} to do{' '}
                  <span className="inline-flex -translate-y-1.5 items-center gap-1 rounded-full bg-white px-3 py-1 align-middle text-sm font-semibold">
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
                  today
                </h2>
              )}

              {stats.total > 0 && (
                <div className="mt-7 flex items-center gap-4">
                  <div
                    className="h-2.5 flex-1 overflow-hidden rounded-full bg-white/55"
                    role="progressbar"
                    aria-valuenow={pct}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label="Tasks done today"
                  >
                    <div className="h-full rounded-full bg-ink transition-all" style={{ width: `${Math.max(pct, 3)}%` }} />
                  </div>
                  <span className="shrink-0 text-sm font-semibold">
                    {stats.done}/{stats.total} done
                  </span>
                </div>
              )}
            </div>
          </Bento>

          {stats.total > 0 && (
            <div className="grid grid-cols-3 gap-3">
              <Stat label="Done" value={`${stats.done}/${stats.total}`} />
              <Stat label="Still planned" value={formatDuration(stats.plannedLeft)} />
              <Stat label="Free time left" value={formatDuration(stats.free)} />
            </div>
          )}

          {stats.missed > 0 && stats.remaining > 0 && (
            <Bento tone="coral" className="rise flex items-center gap-4">
              <div className="min-w-0 flex-1">
                <p className="text-lg font-semibold">
                  {stats.missed} {stats.missed === 1 ? 'block' : 'blocks'} slipped by
                </p>
                <p className="text-sm font-medium opacity-75">Re-plan the rest of today in one tap.</p>
              </div>
              <IconButton
                label="Re-plan from now"
                size={48}
                onClick={async () => {
                  await replanAll();
                  toast('Re-planned from now.');
                }}
              >
                <RefreshCw size={19} />
              </IconButton>
            </Bento>
          )}

          {risk && stats.missed === 0 && (
            <Bento tone="sun" className="rise flex items-center gap-4">
              <TriangleAlert size={22} className="shrink-0" />
              <p className="min-w-0 flex-1 font-medium">{risk.message}</p>
              <Link to="/calendar" aria-label="See how to fix it" className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-ink text-white">
                <ArrowUpRight size={19} />
              </Link>
            </Bento>
          )}

          {brief.available && brief.hasPlan && (
            <Bento tone="lilac" className="rise">
              <div className="flex items-center gap-2">
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-ink text-white">
                  <Sparkles size={15} />
                </span>
                <Kicker>Your day, briefly</Kicker>
                {(brief.text || brief.error) && !brief.loading && (
                  <button
                    type="button"
                    onClick={() => void brief.refresh()}
                    className={`ml-auto inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold ${brief.stale ? 'bg-ink text-white' : 'bg-white/60 hover:bg-white'}`}
                  >
                    <RefreshCw size={13} /> {brief.stale ? 'Plan changed · refresh' : 'Refresh'}
                  </button>
                )}
              </div>
              {brief.loading ? (
                <div className="mt-4 grid gap-2" aria-label="Writing your brief">
                  <div className="h-3.5 w-11/12 animate-pulse rounded-full bg-ink/10" />
                  <div className="h-3.5 w-3/4 animate-pulse rounded-full bg-ink/10" />
                </div>
              ) : brief.text ? (
                <p className="mt-3 text-[17px] font-medium leading-relaxed">{brief.text}</p>
              ) : (
                <p className="mt-3 text-sm font-medium opacity-75">{brief.error}</p>
              )}
            </Bento>
          )}

          {next && (
            <Bento tone="cream" className="rise flex items-center gap-4">
              <DateBlock top={nextTime[0]} bottom={nextTime[1]} className="!h-16 !w-16" />
              <button type="button" disabled={!next.task} onClick={() => next.task && select(next.task.id)} className="min-w-0 flex-1 text-left">
                <p className="text-xs font-semibold uppercase tracking-wider opacity-70">{next.start <= now ? 'Happening now' : 'Up next'}</p>
                <p className="truncate text-xl font-semibold">{next.title}</p>
                <p className="text-sm font-medium opacity-65">
                  {next.start <= now
                    ? `Until ${formatTime(next.end, tz)}`
                    : `In ${formatDuration(Math.max(1, Math.round((next.start - now) / MIN)))} · ${formatDuration((next.end - next.start) / MIN)}`}
                </p>
              </button>
              {next.task && next.kind === 'block' ? (
                <IconButton label={`Start focus on ${next.title}`} onClick={() => startFocus(next.task!.id)} size={52}>
                  <Play size={20} fill="currentColor" className="ml-0.5" />
                </IconButton>
              ) : next.task ? (
                <IconButton
                  label={`Mark ${next.title} done`}
                  size={52}
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
        </div>

        <div className="grid gap-5 lg:col-span-5">
          <section aria-label="Your day" className="rounded-[28px] bg-surface p-4 ring-1 ring-line lg:p-5">
            <div className="mb-3 flex items-center justify-between gap-2 px-1">
              <h2 className="text-lg font-semibold">Your day</h2>
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
              <div className="rounded-[20px] bg-surface-2/70 p-8 text-center">
                <p className="font-semibold">Nothing scheduled</p>
                <p className="mt-1 text-sm text-muted">Add something and it shows up here.</p>
              </div>
            ) : view === 'list' ? (
              <DayList items={items} tz={tz} now={now} />
            ) : (
              <DayTimeline day={now} tasks={tasks} fixedItems={fixed} profile={profile} now={now} />
            )}

            {stats.doneTasks.length > 0 && (
              <div className="mt-4 border-t border-line pt-4">
                <h3 className="mb-2 px-1 text-sm font-semibold text-muted">Done today · {stats.doneTasks.length}</h3>
                <ul className="grid gap-1">
                  {stats.doneTasks.map((t) => (
                    <li key={t.id}>
                      <button type="button" onClick={() => select(t.id)} className="flex w-full items-center gap-3 rounded-[16px] px-3 py-2 text-left hover:bg-surface-2">
                        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-card-lime text-ink">
                          <Check size={13} strokeWidth={3} />
                        </span>
                        <span className="flex-1 truncate text-sm font-medium text-muted line-through">{t.title}</span>
                        {t.spentMin > 0 && <span className="text-xs text-muted">{formatDuration(t.spentMin)}</span>}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>

          <TodayHabits habits={habits} logs={habitLogs} today={today} />
          <EveningCheckin key={today} date={today} existing={checkins.find((c) => c.date === today)} hour={hour} />
        </div>
      </div>
    </div>
  );
}
