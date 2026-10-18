import { Flame, Plus, Repeat, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { habitStreak, isScheduledOn } from '../../supabase/functions/_shared/analytics.ts';
import { addDays as addDayKeys } from '../../supabase/functions/_shared/zone.ts';
import { Sheet } from '../components/Sheet';
import { Button, Card, EmptyState, fieldClass, Skeleton } from '../components/ui';
import { HabitCheck } from '../features/habits/HabitCheck';
import type { PlannerData } from '../hooks/useData';
import { addHabit, deleteHabit, updateHabit } from '../lib/db/habitActions';
import { ALL_DAYS, describeDays, WEEKDAYS } from '../lib/habits';
import { dayKey } from '../lib/time/tz';
import type { Habit } from '../lib/types';
import { useUi } from '../store/ui';

const LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function DayPicker({ value, onChange }: { value: number[]; onChange: (days: number[]) => void }) {
  return (
    <div className="grid gap-2">
      <div role="group" aria-label="Days" className="flex gap-1.5">
        {LETTERS.map((letter, d) => {
          const on = value.includes(d);
          return (
            <button
              key={d}
              type="button"
              aria-pressed={on}
              aria-label={NAMES[d]}
              onClick={() => onChange(on ? value.filter((x) => x !== d) : [...value, d].sort())}
              className={`h-9 w-9 rounded-full text-sm font-semibold ${on ? 'bg-teal-700 text-white' : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200'}`}
            >
              {letter}
            </button>
          );
        })}
      </div>
      <div className="flex gap-2 text-xs">
        <button type="button" className="font-medium text-teal-800 hover:underline dark:text-teal-300" onClick={() => onChange(ALL_DAYS)}>
          Every day
        </button>
        <button type="button" className="font-medium text-teal-800 hover:underline dark:text-teal-300" onClick={() => onChange(WEEKDAYS)}>
          Weekdays
        </button>
      </div>
    </div>
  );
}

function HabitEditor({ habit, onClose }: { habit: Habit | 'new'; onClose: () => void }) {
  const toast = useUi((s) => s.toast);
  const [title, setTitle] = useState(habit === 'new' ? '' : habit.title);
  const [days, setDays] = useState<number[]>(habit === 'new' ? ALL_DAYS : habit.days);
  const valid = title.trim() && days.length > 0;

  const save = async () => {
    if (!valid) return;
    if (habit === 'new') {
      const { undo } = await addHabit({ title, days });
      toast(`Added habit “${title.trim()}”.`, { undo });
    } else {
      await updateHabit(habit.id, { title: title.trim(), days });
    }
    onClose();
  };

  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <div>
        <label htmlFor="habit-title" className="mb-1 block text-sm font-medium">
          Habit
        </label>
        <input id="habit-title" autoFocus className={fieldClass} value={title} placeholder="Read 20 pages" onChange={(e) => setTitle(e.target.value)} />
      </div>
      <div>
        <p className="mb-1 text-sm font-medium">Repeat on</p>
        <DayPicker value={days} onChange={setDays} />
        {days.length === 0 && <p className="mt-1 text-xs text-red-800 dark:text-red-300">Pick at least one day.</p>}
      </div>
      <div className="flex justify-between gap-2">
        {habit !== 'new' ? (
          <Button
            variant="ghost"
            className="!text-red-700 dark:!text-red-300"
            onClick={async () => {
              const undo = await deleteHabit(habit.id);
              toast(`Deleted “${habit.title}”.`, { undo });
              onClose();
            }}
          >
            <Trash2 size={15} /> Delete
          </Button>
        ) : (
          <span />
        )}
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={!valid}>
            Save
          </Button>
        </div>
      </div>
    </form>
  );
}

export function HabitsPage({ data }: { data: PlannerData }) {
  const { habits, habitLogs, profile, now, loading } = data;
  const [editing, setEditing] = useState<Habit | 'new' | null>(null);
  const today = dayKey(now, profile.timezone);
  const week = useMemo(() => Array.from({ length: 7 }, (_, i) => addDayKeys(today, i - 6)), [today]);
  const doneOn = useMemo(() => new Set(habitLogs.map((l) => `${l.habitId}:${l.date}`)), [habitLogs]);

  if (loading) return <Skeleton className="h-64" />;

  return (
    <div className="grid gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Habits</h1>
        <Button variant="primary" size="sm" onClick={() => setEditing('new')}>
          <Plus size={15} /> New habit
        </Button>
      </div>

      {habits.length === 0 ? (
        <Card>
          <EmptyState icon={<Repeat size={22} />} title="Build a streak">
            Small things you want to do regularly: reading, a walk, journaling. Tap “New habit”, or type <code>habit: read 20 pages</code> below.
          </EmptyState>
        </Card>
      ) : (
        <ul className="grid gap-3">
          {habits.map((habit) => {
            const streak = habitStreak(habit, habitLogs, today);
            const scheduledToday = isScheduledOn(habit, today);
            return (
              <li key={habit.id}>
                <Card className="flex items-center gap-3 !p-3">
                  {scheduledToday ? (
                    <HabitCheck habitId={habit.id} title={habit.title} date={today} done={doneOn.has(`${habit.id}:${today}`)} />
                  ) : (
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs text-slate-500" title="Not scheduled today">
                      –
                    </span>
                  )}
                  <button type="button" onClick={() => setEditing(habit)} className="min-w-0 flex-1 text-left">
                    <span className="block truncate font-medium">{habit.title}</span>
                    <span className="block text-xs text-slate-600 dark:text-slate-400">
                      {describeDays(habit.days)}
                      {!scheduledToday && ' · rest day'}
                    </span>
                  </button>
                  <div className="hidden gap-1 sm:flex" aria-label="Last 7 days">
                    {week.map((date) => {
                      const scheduled = isScheduledOn(habit, date);
                      const done = doneOn.has(`${habit.id}:${date}`);
                      return (
                        <span
                          key={date}
                          title={`${date}: ${done ? 'done' : scheduled ? 'missed' : 'rest day'}`}
                          className={`h-2.5 w-2.5 rounded-full ${done ? 'bg-teal-600' : scheduled ? 'bg-slate-300 dark:bg-slate-600' : 'bg-transparent ring-1 ring-slate-300 dark:ring-slate-700'}`}
                        />
                      );
                    })}
                  </div>
                  <div className="w-16 shrink-0 text-right" title={`Best streak: ${streak.best}`}>
                    <span className={`inline-flex items-center gap-1 font-semibold ${streak.current ? 'text-orange-700 dark:text-orange-300' : 'text-slate-500'}`}>
                      <Flame size={16} aria-hidden /> {streak.current}
                    </span>
                    <span className="sr-only"> day streak</span>
                    <span className="block text-[11px] text-slate-600 dark:text-slate-400">best {streak.best}</span>
                  </div>
                </Card>
              </li>
            );
          })}
        </ul>
      )}

      <Sheet open={editing !== null} onClose={() => setEditing(null)} title={editing === 'new' ? 'New habit' : 'Edit habit'}>
        {editing !== null && <HabitEditor habit={editing} onClose={() => setEditing(null)} />}
      </Sheet>
    </div>
  );
}
