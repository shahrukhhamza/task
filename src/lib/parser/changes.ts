import { minutesOfDay, startOfDayTz } from '../time/tz';
import { parseDates } from './chronoTz';
import { extractDuration, extractPriority } from './extract';
import { normalizeDayParts } from './spokenTime';
import type { ParseContext, TaskChange } from './types';
import { resolveWhen } from './when';

/** A bare "7", "6:30" or "at 7": a clock face with no am/pm. Hours 1 to 6 and 12 lean to the afternoon, like new tasks. */
function bareClock(text: string): { min: number; guessed: boolean } | undefined {
  const m = /^(?:at\s+|to\s+)?(\d{1,2})(?:[:.](\d{2}))?$/.exec(text.trim());
  if (!m) return undefined;
  const hour = parseInt(m[1], 10);
  const minute = m[2] ? parseInt(m[2], 10) : 0;
  if (hour > 23 || minute > 59) return undefined;
  if (hour > 12 || hour === 0) return { min: hour * 60 + minute, guessed: false };
  return { min: (hour % 12) * 60 + minute + ((hour >= 1 && hour <= 6) || hour === 12 ? 720 : 0), guessed: true };
}

/**
 * What a phrase like "7 to 8 pm", "tomorrow at 5", "30 minutes" or "high priority" changes about a
 * task. Returns null when it holds nothing a task could change.
 */
export function parseChange(phrase: string, ctx: ParseContext): TaskChange | null {
  let text = normalizeDayParts(phrase.trim().replace(/[.!?]+$/, ''));
  const change: TaskChange = {};

  const priority = extractPriority(text);
  if (priority.value && priority.text !== text) {
    change.priority = priority.value;
    text = priority.text;
  }

  const duration = extractDuration(text);
  if (duration.value) {
    change.durationMin = duration.value;
    text = duration.text;
  }

  const found = parseDates(text, ctx)[0];
  const bare = found ? undefined : bareClock(text);
  if (bare) {
    change.startMin = bare.min;
    if (bare.guessed) change.ampmGuessed = true;
  }
  if (found) {
    const { start, end } = resolveWhen(found, ctx.timezone);
    if (found.hasTime) {
      change.startMin = minutesOfDay(start, ctx.timezone);
      if (end !== undefined) change.endMin = minutesOfDay(end, ctx.timezone);
      if (!found.meridiemCertain && !found.endMeridiemCertain) change.ampmGuessed = true;
    }
    // "in 30 minutes" is measured from now, so it names a day too
    if (found.dateCertain || /^in\s|from now/i.test(found.text)) change.day = startOfDayTz(start, ctx.timezone);
  }
  return Object.keys(change).length ? change : null;
}

/** The clock time in "from 6 pm to 7 pm" (the task's current time), as minutes after midnight. */
export function parseFromMinutes(phrase: string, ctx: ParseContext): { min: number; guessed: boolean } | undefined {
  const text = normalizeDayParts(phrase.trim());
  const found = parseDates(text, ctx)[0];
  if (!found) return bareClock(text);
  if (!found.hasTime) return undefined;
  return { min: minutesOfDay(resolveWhen(found, ctx.timezone).start, ctx.timezone), guessed: !found.meridiemCertain && !found.endMeridiemCertain };
}
