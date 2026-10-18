import type { ParsedTask } from '../../lib/parser';
import { formatDayLabel, formatDuration, formatTime } from '../../lib/time/tz';
import type { Recurrence } from '../../lib/types';

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function describeRecurrence(r: Recurrence): string {
  if (r.freq === 'daily') return r.interval === 1 ? 'Every day' : `Every ${r.interval} days`;
  if (r.freq === 'monthly') return r.interval === 1 ? 'Every month' : `Every ${r.interval} months`;
  if (r.byDay?.length === 5 && r.byDay.join() === '1,2,3,4,5') return 'Weekdays';
  if (r.byDay?.length) return `Every ${r.byDay.map((d) => DAY_NAMES[d]).join(', ')}`;
  return r.interval === 1 ? 'Every week' : `Every ${r.interval} weeks`;
}

/** "Fri 4:00 – 5:00 PM" for appointments, "Due Thu" for deadlines. */
export function describeWhen(task: Pick<ParsedTask, 'fixedStart' | 'fixedEnd' | 'dueAt'>, tz: string, now: number): string | undefined {
  if (task.fixedStart !== undefined) {
    const end = task.fixedEnd !== undefined ? ` – ${formatTime(task.fixedEnd, tz)}` : '';
    return `${formatDayLabel(task.fixedStart, tz, now)} ${formatTime(task.fixedStart, tz)}${end}`;
  }
  if (task.dueAt !== undefined) {
    const endOfDay = task.dueAt % 60_000 === 59_999;
    return `Due ${formatDayLabel(task.dueAt, tz, now)}${endOfDay ? '' : ` ${formatTime(task.dueAt, tz)}`}`;
  }
  return undefined;
}

export const describeDuration = (min?: number): string | undefined => (min ? formatDuration(min) : undefined);
