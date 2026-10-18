import { extractRecurrence, inferCategory } from './parser/extract';

export const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];
export const WEEKDAYS = [1, 2, 3, 4, 5];
const SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** "Every day", "Weekdays", "Mon, Wed, Fri". */
export function describeDays(days: number[]): string {
  const sorted = [...new Set(days)].sort();
  if (sorted.length === 7) return 'Every day';
  if (sorted.join() === WEEKDAYS.join()) return 'Weekdays';
  if (sorted.join() === '0,6') return 'Weekends';
  return sorted.map((d) => SHORT[d]).join(', ');
}

/**
 * "habit: read 20 pages", "new habit meditate every weekday".
 * Returns null when the text isn't a habit request, so normal parsing can take over.
 */
export function parseHabit(input: string): { title: string; days: number[]; category: string } | null {
  const m = /^\s*(?:new\s+|add\s+(?:a\s+)?)?habit\s*[:\-–]?\s+(.+)$/i.exec(input);
  if (!m) return null;
  const rec = extractRecurrence(m[1]);
  let days = ALL_DAYS;
  if (rec.value?.freq === 'weekly' && rec.value.byDay?.length) days = rec.value.byDay;

  // the recurrence step leaves a weekday name behind for the date parser; habits don't need it
  const title = rec.text
    .replace(/\b(?:sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s,.-]+|[\s,.-]+$/g, '')
    .replace(/\s+(?:on|at|every|each)$/i, '');
  if (!title) return null;
  return { title: title.charAt(0).toUpperCase() + title.slice(1), days, category: inferCategory(title) ?? 'personal' };
}
