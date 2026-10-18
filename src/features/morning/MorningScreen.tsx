import { CheckCircle2, ChevronDown, ChevronUp, Sparkles, TriangleAlert } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Button, Card, Chip } from '../../components/ui';
import type { PlannerData } from '../../hooks/useData';
import { applySuggestion, replanAll } from '../../lib/db/actions';
import { dayFeasibility, statsFromTasks } from '../../lib/scheduler';
import { dayKey, endOfDayTz, formatDuration, formatTime, MIN, startOfDayTz } from '../../lib/time/tz';
import { useUi } from '../../store/ui';

const greeting = (hour: number) => (hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening');

const STORAGE_KEY = 'dayflow-morning-closed';

function readClosed(today: string): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === today;
  } catch {
    return false;
  }
}

/** Today's plan at a glance: what's planned, what rolled over, and whether it all fits. */
export function MorningScreen({ data }: { data: PlannerData }) {
  const { tasks, fixedEvents, profile, now, livePlan } = data;
  const tz = profile.timezone;
  const toast = useUi((s) => s.toast);
  const today = dayKey(now, tz);
  const [closed, setClosed] = useState(() => readClosed(today));

  const stats = useMemo(() => {
    const start = startOfDayTz(now, tz);
    const end = endOfDayTz(now, tz);
    const active = tasks.filter((t) => ['todo', 'scheduled', 'doing'].includes(t.status));
    const allToday = active.flatMap((t) => t.blocks).filter((b) => b.start < end && b.end > start);
    // only what's still ahead; passed blocks are covered by the "you're behind" banner
    const todays = allToday.filter((b) => b.end > now);
    const plannedMin = todays.reduce((sum, b) => sum + (b.end - b.start) / MIN, 0);
    const finishAt = todays.reduce((latest, b) => Math.max(latest, b.end), 0);
    const carried = active.filter((t) => (t.carriedOverAt ?? 0) >= start || t.blocks.some((b) => b.end <= start));
    const feasibility = dayFeasibility({ tasks, fixedEvents, profile, now, estimates: statsFromTasks(tasks) }, livePlan);
    const fixedToday = livePlan.fixed.filter((f) => f.start < end && f.end > Math.max(start, now) && !f.done).length;
    const doneToday = tasks.some((t) => t.status === 'done' && (t.completedAt ?? 0) >= start);
    return { plannedMin, finishAt, carried, feasibility, fixedToday, blockCount: todays.length, hadPlan: allToday.length > 0 || doneToday };
  }, [tasks, fixedEvents, profile, now, tz, livePlan]);

  const hour = Number(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, timeZone: tz }).format(now)) % 24;
  const risks = livePlan.risks.filter((r) => r.kind === 'miss');
  const toggle = () => {
    const next = !closed;
    setClosed(next);
    try {
      if (next) localStorage.setItem(STORAGE_KEY, today);
      else localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* storage is optional */
    }
  };

  const { feasibility } = stats;

  return (
    <Card className="mb-4">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={!closed}
        className="flex w-full items-center justify-between gap-3 text-left"
      >
        <span className="flex items-center gap-2">
          <Sparkles size={18} className="text-teal-700 dark:text-teal-300" />
          <span className="font-semibold">{greeting(hour)}</span>
          {closed && (
            <span className="text-sm text-slate-600 dark:text-slate-400">
              {stats.blockCount} blocks · {formatDuration(stats.plannedMin)}
            </span>
          )}
        </span>
        {closed ? <ChevronDown size={18} /> : <ChevronUp size={18} />}
      </button>

      {!closed && (
        <div className="mt-3 grid gap-3 text-sm">
          {stats.blockCount === 0 && stats.fixedToday === 0 ? (
            <p className="text-slate-700 dark:text-slate-300">
              {stats.hadPlan
                ? 'Nothing left on today’s plan.'
                : 'Nothing is planned for today yet. Add a task below and I’ll find time for it.'}
            </p>
          ) : (
            <p>
              You have <strong>{formatDuration(stats.plannedMin)}</strong> of focused work left in {stats.blockCount}{' '}
              {stats.blockCount === 1 ? 'block' : 'blocks'}
              {stats.fixedToday > 0 && (
                <>
                  {' '}
                  and {stats.fixedToday} fixed {stats.fixedToday === 1 ? 'commitment' : 'commitments'}
                </>
              )}
              {stats.finishAt > 0 && <>, wrapping up around {formatTime(stats.finishAt, tz)}</>}.
            </p>
          )}

          <div
            className={`flex items-start gap-2 rounded-xl p-3 ${
              feasibility.canFinish ? 'bg-emerald-50 text-emerald-950 dark:bg-emerald-900/20 dark:text-emerald-100' : 'bg-amber-50 text-amber-950 dark:bg-amber-900/25 dark:text-amber-100'
            }`}
          >
            {feasibility.canFinish ? <CheckCircle2 size={18} className="mt-0.5 shrink-0" /> : <TriangleAlert size={18} className="mt-0.5 shrink-0" />}
            <div className="grid gap-2">
              <p className="font-medium">
                {feasibility.canFinish
                  ? 'Yes, everything due today fits.'
                  : `Not everything due today fits (${feasibility.atRisk.length} at risk).`}
              </p>
              <p className="opacity-90">
                {formatDuration(feasibility.plannedMin)} planned, {formatDuration(feasibility.availableMin)} of working time left today.
              </p>
              {!feasibility.canFinish &&
                risks
                  .filter((r) => feasibility.atRisk.some((t) => t.id === r.taskId))
                  .map((r) => (
                    <div key={r.taskId} className="grid gap-1">
                      <p>{r.message}</p>
                      <div className="flex flex-wrap gap-1.5">
                        {r.suggestions
                          .filter((s) => s.action !== 'extend' && s.taskId)
                          .map((s) => (
                            <Button
                              key={`${s.action}-${s.taskId}`}
                              size="sm"
                              onClick={async () => {
                                const undo = await applySuggestion(s.taskId as string, s.action as 'move' | 'drop', s.startAfter);
                                toast('Plan updated.', { undo });
                              }}
                            >
                              {s.text}
                            </Button>
                          ))}
                      </div>
                    </div>
                  ))}
            </div>
          </div>

          {stats.carried.length > 0 && (
            <div>
              <p className="mb-1.5 font-medium">Carried over from earlier</p>
              <div className="flex flex-wrap gap-1.5">
                {stats.carried.map((t) => (
                  <Chip key={t.id} tone="amber">
                    {t.title}
                  </Chip>
                ))}
              </div>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <Button
              variant="primary"
              size="sm"
              onClick={async () => {
                await replanAll();
                toast('Planned the rest of your day.');
              }}
            >
              Plan my day
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
