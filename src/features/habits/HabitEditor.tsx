import { Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Button } from '../../components/ui';
import { addHabit, deleteHabit, updateHabit } from '../../lib/db/habitActions';
import { ALL_DAYS, WEEKDAYS } from '../../lib/habits';
import type { Habit } from '../../lib/types';
import { useUi } from '../../store/ui';

const LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Name a habit and pick its days. */
export function HabitEditor({ habit, onClose }: { habit: Habit | 'new'; onClose: () => void }) {
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
      className="grid gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <div>
        <label htmlFor="habit-title" className="sr-only">
          Habit
        </label>
        <input
          id="habit-title"
          autoFocus
          className="w-full bg-transparent text-2xl font-semibold placeholder:text-muted focus:outline-none"
          value={title}
          placeholder="Read 20 pages"
          onChange={(e) => setTitle(e.target.value)}
        />
      </div>
      <div>
        <p className="mb-2 text-sm font-medium">Repeat on</p>
        <div role="group" aria-label="Days" className="flex gap-1.5">
          {LETTERS.map((letter, d) => {
            const on = days.includes(d);
            return (
              <button
                key={d}
                type="button"
                aria-pressed={on}
                aria-label={NAMES[d]}
                onClick={() => setDays(on ? days.filter((x) => x !== d) : [...days, d].sort())}
                className={`h-11 w-11 rounded-full text-sm font-semibold transition ${on ? 'bg-fg text-app' : 'bg-surface-2 text-fg'}`}
              >
                {letter}
              </button>
            );
          })}
        </div>
        <div className="mt-3 flex gap-2">
          <button type="button" className="rounded-full bg-surface-2 px-3.5 py-1.5 text-sm font-medium" onClick={() => setDays(ALL_DAYS)}>
            Every day
          </button>
          <button type="button" className="rounded-full bg-surface-2 px-3.5 py-1.5 text-sm font-medium" onClick={() => setDays(WEEKDAYS)}>
            Weekdays
          </button>
        </div>
        {days.length === 0 && <p className="mt-2 text-sm font-medium text-red-700 dark:text-red-300">Pick at least one day.</p>}
      </div>
      <div className="flex items-center justify-between gap-2">
        {habit !== 'new' ? (
          <Button
            variant="ghost"
            onClick={async () => {
              const undo = await deleteHabit(habit.id);
              toast(`Deleted “${habit.title}”.`, { undo });
              onClose();
            }}
          >
            <Trash2 size={16} /> Delete
          </Button>
        ) : (
          <span />
        )}
        <Button type="submit" variant="primary" disabled={!valid}>
          Save habit
        </Button>
      </div>
    </form>
  );
}
