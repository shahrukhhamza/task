import { Flame } from 'lucide-react';
import { Link } from 'react-router-dom';
import { habitStreak, isScheduledOn } from '../../../supabase/functions/_shared/analytics.ts';
import type { Habit, HabitLog } from '../../lib/types';
import { HabitCheck } from './HabitCheck';

/** Today's habits as one-tap check-offs. */
export function TodayHabits({ habits, logs, today }: { habits: Habit[]; logs: HabitLog[]; today: string }) {
  const due = habits.filter((h) => !h.archived && isScheduledOn(h, today));
  if (!due.length) return null;
  const done = new Set(logs.filter((l) => l.date === today).map((l) => l.habitId));

  return (
    <section aria-label="Today’s habits" className="rounded-[28px] bg-surface p-4">
      <div className="mb-3 flex items-baseline justify-between px-1">
        <h2 className="font-bold">
          Habits <span className="text-muted">· {done.size}/{due.length}</span>
        </h2>
        <Link to="/progress" className="text-sm font-semibold text-muted hover:text-fg">
          See all
        </Link>
      </div>
      <ul className="grid gap-2">
        {due.map((habit) => {
          const streak = habitStreak(habit, logs, today).current;
          return (
            <li key={habit.id} className="flex items-center gap-3 rounded-[20px] bg-surface-2 py-2 pl-2 pr-4">
              <HabitCheck habitId={habit.id} title={habit.title} date={today} done={done.has(habit.id)} size={36} />
              <span className={`flex-1 truncate font-semibold ${done.has(habit.id) ? 'text-muted line-through' : ''}`}>{habit.title}</span>
              {streak > 0 && (
                <span className="inline-flex items-center gap-0.5 text-sm font-bold text-orange-600 dark:text-orange-300" aria-label={`${streak} day streak`}>
                  <Flame size={15} aria-hidden />
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
