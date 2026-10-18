import { Check } from 'lucide-react';
import { toggleHabit } from '../../lib/db/habitActions';

/** Round check-off button; lime when done. */
export function HabitCheck({ habitId, title, date, done, size = 40 }: { habitId: string; title: string; date: string; done: boolean; size?: number }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={done}
      aria-label={`${title}: ${done ? 'done' : 'not done'} today`}
      onClick={() => void toggleHabit(habitId, date)}
      style={{ width: size, height: size }}
      className={`group flex shrink-0 items-center justify-center rounded-full border-2 transition ${
        done ? 'border-card-lime bg-card-lime text-ink' : 'border-fg/25 text-transparent hover:border-fg hover:text-fg'
      }`}
    >
      <Check size={Math.round(size * 0.48)} strokeWidth={3} />
    </button>
  );
}
