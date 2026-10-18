import { TZDate } from '@date-fns/tz';
import { addDays, format } from 'date-fns';
import { formatDuration } from '../time/tz';
import type { Recurrence, Task } from '../types';

/** When a task should appear on a calendar. */
export interface EventTiming {
  start: number;
  end: number;
  allDay: boolean;
  /** Deadline-only tasks show as "Due: …". */
  isDeadline: boolean;
}

const DAY_CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

/**
 * Appointments use their fixed time, planned tasks their first block, and tasks with only
 * a deadline become a deadline marker. Returns null when there is nothing to put on a calendar yet.
 */
export function eventTiming(task: Task): EventTiming | null {
  if (task.fixedStart !== undefined && task.fixedEnd !== undefined) {
    return { start: task.fixedStart, end: task.fixedEnd, allDay: false, isDeadline: false };
  }
  const first = [...task.blocks].sort((a, b) => a.start - b.start)[0];
  if (first) return { start: first.start, end: first.end, allDay: false, isDeadline: false };
  if (task.dueAt !== undefined) {
    const endOfDay = task.dueAt % 60_000 === 59_999;
    return endOfDay
      ? { start: task.dueAt, end: task.dueAt, allDay: true, isDeadline: true }
      : { start: task.dueAt - 15 * 60_000, end: task.dueAt, allDay: false, isDeadline: true };
  }
  return null;
}

export function recurrenceToRrule(r: Recurrence): string {
  const freq = r.freq === 'daily' ? 'DAILY' : r.freq === 'weekly' ? 'WEEKLY' : 'MONTHLY';
  const parts = [`FREQ=${freq}`];
  if (r.interval > 1) parts.push(`INTERVAL=${r.interval}`);
  if (r.freq === 'weekly' && r.byDay?.length) parts.push(`BYDAY=${r.byDay.map((d) => DAY_CODES[d]).join(',')}`);
  return `RRULE:${parts.join(';')}`;
}

export const eventTitle = (task: Task, timing: EventTiming): string => (timing.isDeadline ? `Due: ${task.title}` : task.title);

export function eventDescription(task: Task): string {
  const bits = [task.fixedStart === undefined ? `~${formatDuration(task.estimateMin)}` : '', `${task.priority === 'med' ? 'medium' : task.priority} priority`, task.category];
  return `${bits.filter(Boolean).join(' · ')}\nPlanned with Dayflow`;
}

/** Local calendar date of an instant, "yyyy-MM-dd". */
const localDate = (ts: number, tz: string) => format(new TZDate(ts, tz), 'yyyy-MM-dd');
const nextLocalDate = (ts: number, tz: string) => format(addDays(new TZDate(ts, tz), 1), 'yyyy-MM-dd');

/** Google event ids allow 0-9 and a-v; the task UUID's hex digits fit, so the id is stable per task. */
export function googleEventId(taskId: string): string {
  const hex = taskId.toLowerCase().replace(/[^0-9a-f]/g, '');
  if (hex.length >= 8) return `df${hex}`;
  let h = 0x811c9dc5;
  for (const ch of taskId) h = Math.imul(h ^ ch.charCodeAt(0), 0x01000193) >>> 0;
  return `df${h.toString(16)}${taskId.length.toString(16)}`;
}

/** The body sent to the Google Calendar API (via the google-calendar Edge Function). */
export function googleEventPayload(task: Task, tz: string) {
  const timing = eventTiming(task);
  if (!timing) return null;
  return {
    summary: eventTitle(task, timing),
    description: eventDescription(task),
    start: timing.allDay ? { date: localDate(timing.start, tz) } : { dateTime: new Date(timing.start).toISOString(), timeZone: tz },
    end: timing.allDay ? { date: nextLocalDate(timing.start, tz) } : { dateTime: new Date(timing.end).toISOString(), timeZone: tz },
    ...(task.recurrence ? { recurrence: [recurrenceToRrule(task.recurrence)] } : {}),
    extendedProperties: { private: { dayflow: '1', dayflowTaskId: task.id } },
  };
}

/** Short stable fingerprint of a payload, to know when Google needs an update. */
export function payloadHash(payload: unknown): string {
  const text = JSON.stringify(payload);
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
  return h.toString(16).padStart(8, '0');
}

const utcStamp = (ts: number) => new Date(ts).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

/** "Add to Google Calendar" link that works without signing in. */
export function googleTemplateUrl(task: Task, tz: string): string | null {
  const timing = eventTiming(task);
  if (!timing) return null;
  const dates = timing.allDay
    ? `${localDate(timing.start, tz).replace(/-/g, '')}/${nextLocalDate(timing.start, tz).replace(/-/g, '')}`
    : `${utcStamp(timing.start)}/${utcStamp(timing.end)}`;
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: eventTitle(task, timing),
    dates,
    details: eventDescription(task),
    ctz: tz,
  });
  if (task.recurrence) params.set('recur', recurrenceToRrule(task.recurrence));
  return `https://calendar.google.com/calendar/render?${params}`;
}
