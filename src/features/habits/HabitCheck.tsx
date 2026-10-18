import { Check } from 'lucide-react';
import { toggleHabit } from '../../lib/db/habitActions';

/** A round check-off button; used on the Habits page and the Today strip. */
export function HabitCheck({ habitId, title, date, done, size = 36 }: { habitId: string; title: string; date: string; done: boolean; size?: number }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={done}
      aria-label={`${title}: ${done ? 'done' : 'not done'} today`}
      onClick={() => void toggleHabit(habitId, date)}
      style={{ width: size, height: size }}
      className={`flex shrink-0 items-center justify-center rounded-full border-2 transition-colors ${
        done
          ? 'border-teal-700 bg-teal-700 text-white dark:border-teal-500 dark:bg-teal-600'
          : 'border-slate-300 text-transparent hover:border-teal-600 hover:text-teal-600 dark:border-slate-600'
      }`}
    >
      <Check size={Math.round(size * 0.5)} strokeWidth={3} />
    </button>
  );
}
