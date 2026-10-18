import { Flame } from 'lucide-react';
import { Link } from 'react-router-dom';
import { habitStreak, isScheduledOn } from '../../../supabase/functions/_shared/analytics.ts';
import type { Habit, HabitLog } from '../../lib/types';
import { HabitCheck } from './HabitCheck';

/** Today's habits as quick check-offs at the top of the Today view. */
export function TodayHabits({ habits, logs, today }: { habits: Habit[]; logs: HabitLog[]; today: string }) {
  const due = habits.filter((h) => !h.archived && isScheduledOn(h, today));
  if (!due.length) return null;
  const done = new Set(logs.filter((l) => l.date === today).map((l) => l.habitId));

  return (
    <section aria-label="Today’s habits" className="mb-4">
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-300">
          Habits · {done.size}/{due.length}
        </h2>
        <Link to="/habits" className="text-xs font-medium text-teal-800 hover:underline dark:text-teal-300">
          All habits
        </Link>
      </div>
      <ul className="flex gap-2 overflow-x-auto pb-1">
        {due.map((habit) => {
          const streak = habitStreak(habit, logs, today).current;
          return (
            <li key={habit.id} className="flex shrink-0 items-center gap-2 rounded-full bg-white py-1 pl-1 pr-3 shadow-sm dark:bg-slate-900">
              <HabitCheck habitId={habit.id} title={habit.title} date={today} done={done.has(habit.id)} size={28} />
              <span className="max-w-[10rem] truncate text-sm">{habit.title}</span>
              {streak > 0 && (
                <span className="inline-flex items-center text-xs font-semibold text-orange-700 dark:text-orange-300" aria-label={`${streak} day streak`}>
                  <Flame size={13} aria-hidden />
                  {streak}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
