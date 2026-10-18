// Timezone helpers built only on Intl, so they run the same in Deno, Node and browsers.

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      weekday: 'short',
    });
    formatters.set(tz, f);
  }
  return f;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export interface LocalParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  /** 0 = Sunday */
  weekday: number;
}

export function localParts(ts: number, tz: string): LocalParts {
  const parts: Record<string, string> = {};
  for (const p of formatter(tz).formatToParts(new Date(ts))) parts[p.type] = p.value;
  return {
    year: +parts.year,
    month: +parts.month,
    day: +parts.day,
    hour: +parts.hour % 24,
    minute: +parts.minute,
    second: +parts.second,
    weekday: WEEKDAYS.indexOf(parts.weekday),
  };
}

/** Offset of the zone from UTC at an instant, in ms. */
function offsetAt(ts: number, tz: string): number {
  const p = localParts(ts, tz);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ts / 1000) * 1000;
}

/** The instant a local wall-clock time happens in `tz` (DST-safe). */
export function zonedTime(year: number, month: number, day: number, hour: number, minute: number, tz: string): number {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  const first = guess - offsetAt(guess, tz);
  const second = guess - offsetAt(first, tz);
  return second;
}

/** "yyyy-MM-dd" of the local day containing `ts`. */
export function dayKeyOf(ts: number, tz: string): string {
  const p = localParts(ts, tz);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

export function parseDayKey(key: string): { year: number; month: number; day: number } {
  const [year, month, day] = key.split('-').map(Number);
  return { year, month, day };
}

/** [start, end) of a local day as instants. */
export function dayBounds(key: string, tz: string): { start: number; end: number } {
  const { year, month, day } = parseDayKey(key);
  const next = new Date(Date.UTC(year, month - 1, day + 1));
  return {
    start: zonedTime(year, month, day, 0, 0, tz),
    end: zonedTime(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), 0, 0, tz),
  };
}

export function addDays(key: string, days: number): string {
  const { year, month, day } = parseDayKey(key);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

/** 0 = Sunday, for a "yyyy-MM-dd" key. */
export const weekdayOfKey = (key: string): number => {
  const { year, month, day } = parseDayKey(key);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
};

export const minutesOfDay = (ts: number, tz: string): number => {
  const p = localParts(ts, tz);
  return p.hour * 60 + p.minute;
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** "Monday, Oct 19" */
export function longDayLabel(key: string): string {
  const { month, day } = parseDayKey(key);
  return `${DAY_NAMES[weekdayOfKey(key)]}, ${MONTHS[month - 1]} ${day}`;
}

/** "Mon" */
export const shortDayLabel = (key: string): string => DAY_NAMES[weekdayOfKey(key)].slice(0, 3);

/** "3:05 PM" */
export function clock(ts: number, tz: string): string {
  const { hour, minute } = localParts(ts, tz);
  return `${hour % 12 === 0 ? 12 : hour % 12}:${String(minute).padStart(2, '0')} ${hour < 12 ? 'AM' : 'PM'}`;
}

/** "3 PM" for an hour of the day. */
export const hourLabel = (hour: number): string => `${hour % 12 === 0 ? 12 : hour % 12} ${hour < 12 ? 'AM' : 'PM'}`;

export function duration(min: number): string {
  const m = Math.round(min);
  if (m < 60) return `${m}m`;
  return m % 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m / 60}h`;
}
