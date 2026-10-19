// A model (or the rules) sometimes hears "change the meeting to 7 pm" as a brand-new task called
// "Meeting". When the sentence says it is an edit and a task with that name already exists, it
// is an edit: this turns the would-be new task into an update of the existing one.

import { isActive } from './db/actions';
import { parseDates } from './parser/chronoTz';
import { extractDuration } from './parser/extract';
import { resolveTarget } from './parser/fuzzy';
import { spokenTimes } from './parser/spokenTime';
import type { ParsedCommand, ParsedTask, ParseContext, TaskChange } from './parser';
import { minutesOfDay, startOfDayTz } from './time/tz';
import type { Task } from './types';

const EDIT_WORDS = /\b(?:update|updated|change|changed|edit|modify|adjust|correct|amend|alter|reschedule|rename|move|moved|shift|instead|actually|rather)\b/i;

export function asUpdate(tasks: ParsedTask[], raw: string, existing: Task[], ctx: ParseContext): ParsedCommand | null {
  if (tasks.length !== 1 || !EDIT_WORDS.test(raw)) return null;
  const parsed = tasks[0];
  const pool = existing.filter(isActive);
  if (resolveTarget(parsed.title, pool).kind === 'none') return null;

  const change: TaskChange = {};
  if (parsed.fixedStart !== undefined) {
    change.startMin = minutesOfDay(parsed.fixedStart, ctx.timezone);
    // the end only counts when the sentence gave one; otherwise the task keeps its length
    const spoken = spokenTimes(raw);
    const statedEnd = spoken.some((s) => s.end !== undefined) || /\d(?:[:.]\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)?\s*(?:to|until|till|-|–)\s*\d/i.test(raw);
    if (parsed.fixedEnd !== undefined && statedEnd) change.endMin = minutesOfDay(parsed.fixedEnd, ctx.timezone);
    else if (extractDuration(raw).value) change.durationMin = extractDuration(raw).value;
    if (!spoken.length) change.ampmGuessed = true;
    if (parseDates(raw, ctx)[0]?.dateCertain) change.day = startOfDayTz(parsed.fixedStart, ctx.timezone);
  } else if (parsed.durationMin && extractDuration(raw).value) {
    change.durationMin = parsed.durationMin;
  }
  return Object.keys(change).length ? { kind: 'update', target: parsed.title, change } : null;
}
