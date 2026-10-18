import { TZDate } from '@date-fns/tz';
import * as chrono from 'chrono-node/en';
import type { ParsedComponents } from 'chrono-node';
import type { ParseContext } from './types';

export interface DateMatch {
  index: number;
  text: string;
  start: number;
  end?: number;
  hasTime: boolean;
  meridiemCertain: boolean;
  /** Hour as written (0-23), before any am/pm guessing. */
  hour: number | null;
}

/** Rebuilds a timestamp from chrono's wall-clock fields in the real IANA zone, which keeps DST correct. */
function toTimestamp(c: ParsedComponents, tz: string): number {
  return new TZDate(
    c.get('year') ?? 1970,
    (c.get('month') ?? 1) - 1,
    c.get('day') ?? 1,
    c.get('hour') ?? 0,
    c.get('minute') ?? 0,
    c.get('second') ?? 0,
    0,
    tz,
  ).getTime();
}

export function parseDates(text: string, ctx: ParseContext, forwardDate = true): DateMatch[] {
  // A Date whose *local* fields equal the user's wall clock. chrono then works
  // purely on those numbers, so the browser's own timezone never matters.
  const z = new TZDate(ctx.now, ctx.timezone);
  const reference = new Date(z.getFullYear(), z.getMonth(), z.getDate(), z.getHours(), z.getMinutes(), z.getSeconds());
  return chrono
    .parse(text, reference, { forwardDate })
    .map((r) => ({
      index: r.index,
      text: r.text,
      start: toTimestamp(r.start, ctx.timezone),
      end: r.end ? toTimestamp(r.end, ctx.timezone) : undefined,
      hasTime: r.start.isCertain('hour'),
      meridiemCertain: r.start.isCertain('meridiem'),
      hour: r.start.isCertain('hour') ? r.start.get('hour') : null,
    }));
}
