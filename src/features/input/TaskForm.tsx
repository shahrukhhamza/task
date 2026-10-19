import { ChevronDown, X } from 'lucide-react';
import { useId, useState } from 'react';
import { fieldClass } from '../../components/ui';
import type { ParsedTask } from '../../lib/parser';
import { endOfDayTz, fromLocalInput, MIN, toLocalInput } from '../../lib/time/tz';
import type { Priority } from '../../lib/types';
import { useCloud } from '../../store/cloud';
import { describeRecurrence } from './describe';

const CATEGORIES = ['general', 'study', 'work', 'fitness', 'health', 'finance', 'social', 'home', 'personal'];
const DURATIONS = [15, 30, 45, 60, 90, 120];
const PRIORITIES: Array<{ value: Priority; label: string }> = [
  { value: 'low', label: 'Low' },
  { value: 'med', label: 'Normal' },
  { value: 'high', label: 'High' },
];

type When = 'anytime' | 'deadline' | 'fixed';

interface TaskFormProps {
  value: ParsedTask;
  onChange: (next: ParsedTask) => void;
  timezone: string;
}

const label = 'mb-1.5 block text-sm font-medium';

function PillChoice<T extends string | number>({ options, value, onChange, name }: { options: Array<{ value: T; label: string }>; value: T | undefined; onChange: (v: T) => void; name: string }) {
  return (
    <div role="group" aria-label={name} className="flex flex-wrap gap-2">
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={`rounded-full px-4 py-2 text-sm font-medium transition ${value === o.value ? 'bg-fg text-app' : 'bg-surface-2 text-fg hover:brightness-95'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Edits one task: the essentials up front, everything else behind "More options". */
export function TaskForm({ value, onChange, timezone }: TaskFormProps) {
  const id = useId();
  const calendarConnected = useCloud((s) => s.google === 'connected' && !!s.user);
  const [more, setMore] = useState(false);
  const set = (patch: Partial<ParsedTask>) => onChange({ ...value, ...patch });
  const when: When = value.fixedStart !== undefined ? 'fixed' : value.dueAt !== undefined ? 'deadline' : 'anytime';

  const setWhen = (next: When) => {
    if (next === when) return;
    const base = value.fixedStart ?? value.dueAt ?? Math.ceil((Date.now() + 60 * MIN) / (15 * MIN)) * 15 * MIN;
    if (next === 'anytime') set({ fixedStart: undefined, fixedEnd: undefined, dueAt: undefined });
    if (next === 'deadline') set({ fixedStart: undefined, fixedEnd: undefined, dueAt: endOfDayTz(base, timezone) });
    if (next === 'fixed') {
      const start = value.dueAt !== undefined && value.dueAt % MIN === 59_999 ? Math.ceil((Date.now() + 60 * MIN) / (15 * MIN)) * 15 * MIN : base;
      set({ dueAt: undefined, fixedStart: start, fixedEnd: start + (value.durationMin ?? 60) * MIN });
    }
  };

  const setStart = (raw: string) => {
    const start = fromLocalInput(raw, timezone);
    if (start === undefined) return;
    const length = Math.max(15 * MIN, (value.fixedEnd ?? start + 60 * MIN) - (value.fixedStart ?? start));
    set({ fixedStart: start, fixedEnd: start + length, durationMin: Math.round(length / MIN) });
  };

  const setEnd = (raw: string) => {
    const end = fromLocalInput(raw, timezone);
    if (end === undefined || value.fixedStart === undefined || end <= value.fixedStart) return;
    set({ fixedEnd: end, durationMin: Math.round((end - value.fixedStart) / MIN) });
  };

  return (
    <div className="grid gap-5">
      <div>
        <label htmlFor={`${id}-title`} className="sr-only">
          Task
        </label>
        <input
          id={`${id}-title`}
          className="w-full bg-transparent text-2xl font-semibold text-fg placeholder:text-muted focus:outline-none"
          value={value.title}
          placeholder="What do you need to do?"
          onChange={(e) => set({ title: e.target.value })}
        />
      </div>

      <div>
        <p className={label}>When</p>
        <PillChoice
          name="When"
          value={when}
          onChange={setWhen}
          options={[
            { value: 'anytime', label: 'Anytime' },
            { value: 'deadline', label: 'Due by' },
            { value: 'fixed', label: 'At a set time' },
          ]}
        />
        {when === 'deadline' && (
          <input
            aria-label="Due by"
            type="datetime-local"
            className={`${fieldClass} mt-3`}
            value={toLocalInput(value.dueAt as number, timezone)}
            onChange={(e) => {
              const due = fromLocalInput(e.target.value, timezone);
              if (due !== undefined) set({ dueAt: due });
            }}
          />
        )}
        {when === 'fixed' && (
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="text-sm font-medium text-muted">
              Starts
              <input type="datetime-local" className={`${fieldClass} mt-1`} value={toLocalInput(value.fixedStart as number, timezone)} onChange={(e) => setStart(e.target.value)} />
            </label>
            <label className="text-sm font-medium text-muted">
              Ends
              <input
                type="datetime-local"
                className={`${fieldClass} mt-1`}
                value={toLocalInput(value.fixedEnd ?? (value.fixedStart as number) + 60 * MIN, timezone)}
                onChange={(e) => setEnd(e.target.value)}
              />
            </label>
          </div>
        )}
        {when === 'anytime' && <p className="mt-2 text-sm text-muted">Dayflow finds the best time for it.</p>}
      </div>

      {when !== 'fixed' && (
        <div>
          <p className={label}>How long</p>
          <PillChoice
            name="How long"
            value={value.durationMin}
            onChange={(d) => set({ durationMin: d })}
            options={DURATIONS.map((d) => ({ value: d, label: d >= 60 ? `${d / 60}h` : `${d}m` }))}
          />
          {value.durationMin !== undefined && !DURATIONS.includes(value.durationMin) && (
            <p className="mt-2 text-sm text-muted">Currently {value.durationMin} minutes.</p>
          )}
        </div>
      )}

      <div>
        <p className={label}>Priority</p>
        <PillChoice name="Priority" value={value.priority ?? 'med'} onChange={(p) => set({ priority: p })} options={PRIORITIES} />
      </div>

      <div>
        <button
          type="button"
          aria-expanded={more}
          onClick={() => setMore(!more)}
          className="inline-flex items-center gap-1 text-sm font-medium text-muted hover:text-fg"
        >
          More options <ChevronDown size={16} className={`transition ${more ? 'rotate-180' : ''}`} />
        </button>

        {more && (
          <div className="mt-3 grid gap-4 rounded-2xl bg-surface-2/60 p-4">
            <div>
              <label htmlFor={`${id}-cat`} className={label}>
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
            {value.recurrence && (
              <div>
                <span className="inline-flex items-center gap-1 rounded-full bg-card-lilac px-3 py-1.5 text-sm font-medium text-ink">
                  Repeats: {describeRecurrence(value.recurrence)}
                  <button type="button" aria-label="Stop repeating" onClick={() => set({ recurrence: undefined })}>
                    <X size={14} />
                  </button>
                </span>
              </div>
            )}
            <label className="inline-flex items-center gap-3 text-sm font-medium">
              <input
                type="checkbox"
                checked={!!value.addToCalendar}
                onChange={(e) => set({ addToCalendar: e.target.checked })}
                className="h-5 w-5 accent-[var(--app-fg)]"
              />
              Add to Google Calendar
            </label>
            {value.addToCalendar && (
              <p className="-mt-2 text-xs text-muted">
                {calendarConnected
                  ? 'It will appear in your Google Calendar and stay in sync.'
                  : 'Syncs once you connect Google in Settings. Until then, open the task for a calendar link.'}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
