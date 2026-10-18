import { TZDate } from '@date-fns/tz';
import { addMonths } from 'date-fns';
import { addDaysTz, startOfDayTz, weekdayOf } from './time/tz';
import type { Recurrence, Task } from './types';

interface Step {
  days?: number;
  months?: number;
}

/** How far the next occurrence is from the current one. */
function stepFor(rule: Recurrence, anchor: number, tz: string): Step {
  if (rule.freq === 'daily') return { days: rule.interval };
  if (rule.freq === 'monthly') return { months: rule.interval };
  if (rule.byDay?.length) {
    const today = weekdayOf(anchor, tz);
    for (let d = 1; d <= 7; d++) {
      if (rule.byDay.includes((today + d) % 7)) return { days: d };
    }
  }
  return { days: 7 * rule.interval };
}

const shift = (ts: number, step: Step, tz: string): number =>
  step.months ? addMonths(new TZDate(ts, tz), step.months).getTime() : addDaysTz(ts, step.days ?? 0, tz);

/**
 * Builds the next instance of a recurring task, keeping its time of day.
 * Skips occurrences that are already in the past.
 */
export function nextOccurrence(task: Task, now: number, tz: string): Pick<Task, 'fixedStart' | 'fixedEnd' | 'dueAt' | 'startAfter'> | undefined {
  const rule = task.recurrence;
  if (!rule) return undefined;

  const anchor = task.fixedStart ?? task.dueAt ?? startOfDayTz(now, tz);
  let next = { fixedStart: task.fixedStart, fixedEnd: task.fixedEnd, dueAt: task.dueAt };
  let cursor = anchor;

  for (let i = 0; i < 400; i++) {
    const step = stepFor(rule, cursor, tz);
    next = {
      fixedStart: next.fixedStart === undefined ? undefined : shift(next.fixedStart, step, tz),
      fixedEnd: next.fixedEnd === undefined ? undefined : shift(next.fixedEnd, step, tz),
      dueAt: next.dueAt === undefined ? undefined : shift(next.dueAt, step, tz),
    };
    cursor = shift(cursor, step, tz);
    if (cursor > now) break;
  }

  // floating habits have no date of their own; keep them off today's plan until their day comes
  const hasDate = task.fixedStart !== undefined || task.dueAt !== undefined;
  return { ...next, startAfter: hasDate ? undefined : startOfDayTz(cursor, tz) };
}
