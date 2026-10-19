import { MIN, minutesOfDay } from '../time/tz';
import type { DateMatch } from './chronoTz';

const HALF_DAY = 12 * 60 * MIN;

/**
 * The start and end a date phrase means, with the guesses people expect:
 * "dentist at 4" is the afternoon, and an end without am/pm ("lunch 12 to 1", "6 pm to 6:30")
 * is the next time that clock face comes round after the start.
 */
export function resolveWhen(match: DateMatch, tz: string): { start: number; end?: number } {
  let start = match.start;
  let end = match.end;

  if (match.hasTime && !match.meridiemCertain && !match.endMeridiemCertain && match.hour !== null && match.hour >= 1 && match.hour < 7) {
    start += HALF_DAY;
    if (end !== undefined) end += HALF_DAY;
  }
  if (match.hasTime && end !== undefined && !match.endMeridiemCertain) {
    const gap = (((minutesOfDay(end, tz) - minutesOfDay(start, tz)) % 720) + 720) % 720;
    end = start + (gap || 720) * MIN;
  }
  return { start, end };
}
