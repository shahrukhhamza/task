import { TZDate } from '@date-fns/tz';
import { addDays, endOfDay, format, startOfDay } from 'date-fns';

/** Wraps an instant so date-fns reads and writes it in the given zone. */
const zoned = (ts: number, tz: string) => new TZDate(ts, tz);

export const startOfDayTz = (ts: number, tz: string): number => startOfDay(zoned(ts, tz)).getTime();

export const endOfDayTz = (ts: number, tz: string): number => endOfDay(zoned(ts, tz)).getTime();

/** DST-safe: moves by calendar days, not by 24h. */
export const addDaysTz = (ts: number, days: number, tz: string): number =>
  addDays(zoned(ts, tz), days).getTime();

export const minutesOfDay = (ts: number, tz: string): number => {
  const d = zoned(ts, tz);
  return d.getHours() * 60 + d.getMinutes();
};

/** Timestamp for `minutes` after midnight on the same local day as `dayTs`. */
export const atMinutesOfDay = (dayTs: number, minutes: number, tz: string): number => {
  const d = zoned(startOfDayTz(dayTs, tz), tz);
  d.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
  return d.getTime();
};

export const weekdayOf = (ts: number, tz: string): number => zoned(ts, tz).getDay();

export const dayKey = (ts: number, tz: string): string => format(zoned(ts, tz), 'yyyy-MM-dd');

export const isSameDayTz = (a: number, b: number, tz: string): boolean => dayKey(a, tz) === dayKey(b, tz);

export const formatTime = (ts: number, tz: string): string => format(zoned(ts, tz), 'h:mm a');

export const formatDayLabel = (ts: number, tz: string, now: number): string => {
  const diff = Math.round((startOfDayTz(ts, tz) - startOfDayTz(now, tz)) / 86_400_000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  return format(zoned(ts, tz), diff > 0 && diff < 7 ? 'EEEE' : 'EEE, MMM d');
};

export const formatDateTime = (ts: number, tz: string): string => format(zoned(ts, tz), 'EEE, MMM d · h:mm a');

export const formatDuration = (min: number): string => {
  const m = Math.round(min);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h}h ${r}m` : `${h}h`;
};

/** "Thursday's deadline" style phrase used in risk messages. */
export const deadlineLabel = (dueAt: number, tz: string, now: number): string => {
  const diff = Math.round((startOfDayTz(dueAt, tz) - startOfDayTz(now, tz)) / 86_400_000);
  if (diff <= 0) return "today's";
  if (diff === 1) return "tomorrow's";
  if (diff < 7) return `${format(zoned(dueAt, tz), 'EEEE')}'s`;
  return `the ${format(zoned(dueAt, tz), 'MMM d')}`;
};

/** Value for an <input type="datetime-local">, expressed in the profile's timezone. */
export const toLocalInput = (ts: number, tz: string): string => format(zoned(ts, tz), "yyyy-MM-dd'T'HH:mm");

/** Inverse of toLocalInput. Returns undefined for empty or invalid values. */
export function fromLocalInput(value: string, tz: string): number | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value);
  if (!m) return undefined;
  return new TZDate(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], 0, 0, tz).getTime();
}

export const timeZones = (): string[] => {
  try {
    return (Intl as unknown as { supportedValuesOf(k: string): string[] }).supportedValuesOf('timeZone');
  } catch {
    return ['Asia/Karachi', 'UTC'];
  }
};

export const MIN = 60_000;
export const HOUR = 3_600_000;
export const DAY = 86_400_000;
