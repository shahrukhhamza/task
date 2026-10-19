// Models are good at meaning and sloppy at clocks ("8 AM to 9PM" coming back as 08:00-09:00,
// "6 to 6:30" growing into a full hour). Whatever the sentence says out loud about the
// time of day and how long it lasts wins over what the model wrote.

import type { ParsedTask, TaskChange } from '../parser';
import { extractDuration } from '../parser/extract';
import { spokenTimes, type SpokenTime } from '../parser/spokenTime';
import { MIN, minutesOfDay } from '../time/tz';

const HALF_DAY = 12 * 60;

/** Minutes from the start of a range to its end, going forward round the clock. */
const lengthOf = (start: number, end: number, modulus: number): number => (((end - start) % modulus) + modulus) % modulus || modulus;

function fixRange(task: ParsedTask, startMin: number, spoken: SpokenTime[]): ParsedTask {
  const fixedStart = task.fixedStart as number;
  const sameFace = spoken.filter((s) => s.start % HALF_DAY === startMin % HALF_DAY);
  if (!sameFace.length) return task;

  const exact = sameFace.find((s) => !s.bare && s.start === startMin) ?? sameFace.find((s) => s.bare);
  const pick = exact ?? (new Set(sameFace.map((s) => s.start)).size === 1 ? sameFace[0] : undefined);
  if (!pick) return task;

  // "from 6 to 6:30" says nothing about am/pm, so the model's start stands and only the length is taken
  const shift = pick.bare ? 0 : (pick.start - startMin) * MIN;
  const start = fixedStart + shift;
  let end = task.fixedEnd !== undefined ? task.fixedEnd + shift : undefined;
  if (pick.end !== undefined) end = start + (pick.bare ? lengthOf(pick.start, pick.end, HALF_DAY) : lengthOf(pick.start, pick.end, 24 * 60)) * MIN;
  return withTimes(task, start, end);
}

function withTimes(task: ParsedTask, fixedStart: number, fixedEnd: number | undefined): ParsedTask {
  if (fixedStart === task.fixedStart && fixedEnd === task.fixedEnd) return task;
  return { ...task, fixedStart, fixedEnd, durationMin: fixedEnd !== undefined ? Math.round((fixedEnd - fixedStart) / MIN) : task.durationMin };
}

export function applySpokenTimes(tasks: ParsedTask[], raw: string, timezone: string): ParsedTask[] {
  const spoken = spokenTimes(raw);
  const stated = extractDuration(raw).value;
  const fixedCount = tasks.filter((t) => t.fixedStart !== undefined).length;

  return tasks.map((task) => {
    if (task.fixedStart === undefined) return task;
    const startMin = minutesOfDay(task.fixedStart, timezone);
    const fixed = fixRange(task, startMin, spoken);

    // "at 6pm for half an hour": a stated length applies when the sentence has no range of its own
    const hasRange = spoken.some((s) => s.end !== undefined && s.start % HALF_DAY === startMin % HALF_DAY);
    if (!hasRange && stated && fixedCount === 1 && fixed.fixedStart !== undefined && fixed.fixedEnd !== fixed.fixedStart + stated * MIN) {
      return withTimes(fixed, fixed.fixedStart, fixed.fixedStart + stated * MIN);
    }
    return fixed;
  });
}

/**
 * The same check for edits ("change the meeting to 7 pm"): the model's 24-hour times follow what
 * was said about am/pm, and a stated range sets the new end.
 */
export function applySpokenChange(change: TaskChange, raw: string): TaskChange {
  if (change.startMin === undefined) return change;
  const spoken = spokenTimes(raw).filter((s) => !s.bare);
  const sameFace = spoken.filter((s) => s.start % HALF_DAY === (change.startMin as number) % HALF_DAY);
  const pick = sameFace.find((s) => s.start === change.startMin) ?? (new Set(sameFace.map((s) => s.start)).size === 1 ? sameFace[0] : undefined);
  if (!pick) return change;
  const next: TaskChange = { ...change, startMin: pick.start };
  if (pick.end !== undefined) next.endMin = pick.end;
  else if (change.endMin !== undefined) next.endMin = (change.endMin + (pick.start - (change.startMin as number)) + 1440) % 1440;
  return next;
}
