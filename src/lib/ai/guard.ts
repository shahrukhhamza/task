// Models are good at meaning and sloppy at clocks ("8 AM to 9PM" coming back as 08:00-09:00).
// Whatever the sentence says out loud about am/pm wins over what the model wrote.

import type { ParsedTask } from '../parser';
import { spokenTimes } from '../parser/spokenTime';
import { MIN, minutesOfDay } from '../time/tz';

const HALF_DAY = 12 * 60;

export function applySpokenTimes(tasks: ParsedTask[], raw: string, timezone: string): ParsedTask[] {
  const spoken = spokenTimes(raw);
  if (!spoken.length) return tasks;

  return tasks.map((task) => {
    if (task.fixedStart === undefined) return task;
    const startMin = minutesOfDay(task.fixedStart, timezone);
    const sameFace = spoken.filter((s) => s.start % HALF_DAY === startMin % HALF_DAY);
    if (!sameFace.length) return task;

    const exact = sameFace.find((s) => s.start === startMin);
    const pick = exact ?? (new Set(sameFace.map((s) => s.start)).size === 1 ? sameFace[0] : undefined);
    if (!pick) return task;

    const fixedStart = task.fixedStart + (pick.start - startMin) * MIN;
    let fixedEnd = task.fixedEnd !== undefined ? task.fixedEnd + (pick.start - startMin) * MIN : undefined;
    if (pick.end !== undefined) {
      const length = pick.end > pick.start ? pick.end - pick.start : pick.end + 24 * 60 - pick.start;
      fixedEnd = fixedStart + length * MIN;
    }
    if (fixedStart === task.fixedStart && fixedEnd === task.fixedEnd) return task;
    return { ...task, fixedStart, fixedEnd, durationMin: fixedEnd !== undefined ? Math.round((fixedEnd - fixedStart) / MIN) : task.durationMin };
  });
}
