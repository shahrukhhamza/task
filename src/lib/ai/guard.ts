// Models are good at meaning and sloppy at clocks ("8 AM to 9PM" coming back as 08:00-09:00,
// "6 to 6:30" growing into a full hour). Whatever the sentence says out loud about the
// time of day and how long it lasts wins over what the model wrote.

import type { ParsedTask } from '../parser';
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
