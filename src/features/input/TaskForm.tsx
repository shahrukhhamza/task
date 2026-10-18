import { X } from 'lucide-react';
import { useId } from 'react';
import { fieldClass } from '../../components/ui';
import type { ParsedTask } from '../../lib/parser';
import { endOfDayTz, fromLocalInput, MIN, toLocalInput } from '../../lib/time/tz';
import type { Priority } from '../../lib/types';
import { describeRecurrence } from './describe';

const CATEGORIES = ['general', 'study', 'work', 'fitness', 'health', 'finance', 'social', 'home', 'personal'];
const DURATIONS = [15, 30, 45, 60, 90, 120];
const PRIORITIES: Array<{ value: Priority; label: string }> = [
  { value: 'high', label: 'High' },
  { value: 'med', label: 'Medium' },
  { value: 'low', label: 'Low' },
];

interface TaskFormProps {
  value: ParsedTask;
  onChange: (next: ParsedTask) => void;
  timezone: string;
}

/** Edits one parsed task; used for the review cards and for editing saved tasks. */
export function TaskForm({ value, onChange, timezone }: TaskFormProps) {
  const id = useId();
  const isFixed = value.fixedStart !== undefined;
  const set = (patch: Partial<ParsedTask>) => onChange({ ...value, ...patch });

  const setKind = (fixed: boolean) => {
    if (fixed === isFixed) return;
    if (fixed) {
      const start = value.dueAt ?? Date.now() + 60 * MIN;
      const startAt = Math.ceil(start / (15 * MIN)) * 15 * MIN;
      set({ fixedStart: startAt, fixedEnd: startAt + (value.durationMin ?? 60) * MIN, dueAt: undefined });
    } else {
      set({ dueAt: value.fixedStart, fixedStart: undefined, fixedEnd: undefined });
    }
  };

  const setStart = (raw: string) => {
    const start = fromLocalInput(raw, timezone);
    if (start === undefined) return;
    const length = (value.fixedEnd ?? start + 60 * MIN) - (value.fixedStart ?? start);
    set({ fixedStart: start, fixedEnd: start + Math.max(length, 15 * MIN), durationMin: Math.round(Math.max(length, 15 * MIN) / MIN) });
  };

  const setEnd = (raw: string) => {
    const end = fromLocalInput(raw, timezone);
    if (end === undefined || value.fixedStart === undefined || end <= value.fixedStart) return;
    set({ fixedEnd: end, durationMin: Math.round((end - value.fixedStart) / MIN) });
  };

  return (
    <div className="grid gap-3">
      <div>
        <label htmlFor={`${id}-title`} className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">
          Title
        </label>
        <input id={`${id}-title`} className={fieldClass} value={value.title} onChange={(e) => set({ title: e.target.value })} />
      </div>

      <div role="group" aria-label="Type" className="grid grid-cols-2 gap-1 rounded-lg bg-slate-100 p-1 text-sm dark:bg-slate-800">
        {[
          { fixed: false, label: 'Flexible task' },
          { fixed: true, label: 'Appointment' },
        ].map((o) => (
          <button
            key={o.label}
            type="button"
            aria-pressed={isFixed === o.fixed}
            onClick={() => setKind(o.fixed)}
            className={`rounded-md px-3 py-1.5 font-medium ${
              isFixed === o.fixed ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-600 dark:text-white' : 'text-slate-700 dark:text-slate-300'
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>

      {isFixed ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor={`${id}-start`} className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">
              Starts
            </label>
            <input
              id={`${id}-start`}
              type="datetime-local"
              className={fieldClass}
              value={toLocalInput(value.fixedStart as number, timezone)}
              onChange={(e) => setStart(e.target.value)}
            />
          </div>
          <div>
            <label htmlFor={`${id}-end`} className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">
              Ends
            </label>
            <input
              id={`${id}-end`}
              type="datetime-local"
              className={fieldClass}
              value={toLocalInput(value.fixedEnd ?? (value.fixedStart as number) + 60 * MIN, timezone)}
              onChange={(e) => setEnd(e.target.value)}
            />
          </div>
        </div>
      ) : (
        <div>
          <label htmlFor={`${id}-due`} className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">
            Deadline (optional)
          </label>
          <div className="flex gap-2">
            <input
              id={`${id}-due`}
              type="datetime-local"
              className={fieldClass}
              value={value.dueAt !== undefined ? toLocalInput(value.dueAt, timezone) : ''}
              onChange={(e) => set({ dueAt: fromLocalInput(e.target.value, timezone) })}
            />
            {value.dueAt !== undefined && (
              <>
                <button
                  type="button"
                  onClick={() => set({ dueAt: endOfDayTz(value.dueAt as number, timezone) })}
                  className="shrink-0 rounded-lg px-2 text-xs font-medium text-teal-800 hover:bg-teal-50 dark:text-teal-300 dark:hover:bg-slate-800"
                >
                  End of day
                </button>
                <button
                  type="button"
                  aria-label="Clear deadline"
                  onClick={() => set({ dueAt: undefined })}
                  className="shrink-0 rounded-lg p-2 text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  <X size={16} />
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {!isFixed && (
        <div>
          <label htmlFor={`${id}-dur`} className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">
            Time needed (minutes)
          </label>
          <div className="flex flex-wrap items-center gap-1.5">
            <input
              id={`${id}-dur`}
              type="number"
              min={5}
              step={5}
              className={`${fieldClass} !w-24`}
              value={value.durationMin ?? ''}
              placeholder="auto"
              onChange={(e) => set({ durationMin: e.target.value ? Math.max(5, +e.target.value) : undefined })}
            />
            {DURATIONS.map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => set({ durationMin: d })}
                aria-pressed={value.durationMin === d}
                className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                  value.durationMin === d ? 'bg-teal-700 text-white' : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200'
                }`}
              >
                {d >= 60 ? `${d / 60}h` : `${d}m`}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor={`${id}-prio`} className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">
            Priority
          </label>
          <select
            id={`${id}-prio`}
            className={fieldClass}
            value={value.priority ?? 'med'}
            onChange={(e) => set({ priority: e.target.value as Priority })}
          >
            {PRIORITIES.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor={`${id}-cat`} className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">
            Category
          </label>
          <input
            id={`${id}-cat`}
            list={`${id}-cats`}
            className={fieldClass}
            value={value.category ?? 'general'}
            onChange={(e) => set({ category: e.target.value.trim().toLowerCase() || 'general' })}
          />
          <datalist id={`${id}-cats`}>
            {CATEGORIES.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        {value.recurrence && (
          <span className="inline-flex items-center gap-1 rounded-full bg-violet-100 px-2.5 py-1 text-xs font-medium text-violet-900 dark:bg-violet-900/40 dark:text-violet-100">
            Repeats: {describeRecurrence(value.recurrence)}
            <button type="button" aria-label="Remove repeat" onClick={() => set({ recurrence: undefined })}>
              <X size={12} />
            </button>
          </span>
        )}
        <label className="inline-flex items-center gap-2">
          <input
            type="checkbox"
            checked={!!value.addToCalendar}
            onChange={(e) => set({ addToCalendar: e.target.checked })}
            className="h-4 w-4 accent-teal-700"
          />
          Add to Google Calendar
        </label>
      </div>
      {value.addToCalendar && (
        <p className="-mt-1 text-xs text-slate-600 dark:text-slate-400">
          Saved with the task. Calendar sync switches on once you sign in with Google.
        </p>
      )}
    </div>
  );
}
