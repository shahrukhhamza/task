import { endOfDayTz, MIN } from '../time/tz';
import { parseDates } from './chronoTz';
import { resolveWhen } from './when';
import { normalizeDayParts, normalizeMeridiems } from './spokenTime';
import { parseCommand } from './commands';
import {
  expandDateTags,
  extractCalendarFlag,
  extractCategoryTag,
  extractDuration,
  extractPriority,
  extractRecurrence,
  inferCategory,
} from './extract';
import type { TextUnderstander } from './understander';
import type { ParseContext, ParseResult, ParsedTask } from './types';

const DEFAULT_APPOINTMENT_MIN = 60;

/** Words that open a new task, used to decide whether "and" separates two tasks. */
const TASK_VERBS = new Set([
  'call', 'email', 'buy', 'finish', 'submit', 'write', 'read', 'study', 'go', 'send', 'pick', 'clean', 'pay',
  'book', 'meet', 'review', 'prepare', 'fix', 'gym', 'cook', 'plan', 'visit', 'check', 'practice', 'text',
  'schedule', 'ask', 'bring', 'drop', 'wash', 'order', 'print', 'attend', 'do', 'make', 'take', 'water',
  'revise', 'complete', 'update', 'reply', 'return', 'renew', 'register', 'sign', 'file', 'workout', 'run',
]);

/** Strips list markers and leading filler like "remind me to". */
function stripLeadIn(line: string): string {
  return line
    .replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '')
    .replace(/^\s*(?:please\s+)?(?:(?:remind me to|i (?:need|have|want|must|should|gotta|got) to|need to|don'?t forget to|have to|gotta|to-?do:?|task:?)\s+)+/i, '')
    // "I have a meeting ...", "I've got an appointment ...": the noun is the task
    .replace(/^\s*i(?:'ve|\s+have|\s+got|'ve\s+got|\s+have\s+got)\s+(?:an?|the|my|some)\s+(?=\S)/i, '')
    .trim();
}

/** "add a meeting ...", "schedule a call ...", "create a task to ..." name the task that follows. */
function stripAddPhrase(text: string): string {
  return text.replace(
    /^\s*(?:please\s+)?(?:(?:can|could|will|would)\s+you\s+)?(?:add|create|schedule|set\s+up|put\s+in)\s+(?:me\s+)?(?:(?:a|an|the|my|new)\s+)*(?:(?:task|todo|to-do|reminder|event|entry)\s*(?:called|named|for|to|:)?\s*)?/i,
    '',
  );
}

function tidyTitle(raw: string): string {
  let t = raw.replace(/\s+/g, ' ').trim();
  for (let i = 0; i < 3; i++) {
    t = t
      .replace(/^[\s,;:.\-–]+|[\s,;:.\-–]+$/g, '')
      .replace(/(?:^|\s+)(?:due|by|on|at|from|before|until|till|for|in|about|around|and|then|this|next|every|each)$/i, '')
      .replace(/^(?:and|then|also|on|at|to)\s+/i, '');
  }
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** Parses one task phrase (no splitting). Returns a task with an empty title if only attributes were found. */
export function parseTaskPhrase(rawInput: string, ctx: ParseContext): ParsedTask {
  let text = normalizeDayParts(stripLeadIn(rawInput));

  const cat = extractCategoryTag(text);
  text = cat.text;
  const prio = extractPriority(text);
  text = prio.text;
  const cal = extractCalendarFlag(text);
  text = cal.text;
  if (cal.value) text = text.replace(/^\s*(?:add|schedule)\s+/i, '');
  text = stripAddPhrase(text);
  const rec = extractRecurrence(expandDateTags(text));
  text = rec.text;
  const dur = extractDuration(text);
  text = dur.text;

  const task: ParsedTask = { raw: rawInput.trim(), title: '' };
  if (cat.value) task.category = cat.value;
  if (prio.value) task.priority = prio.value;
  if (cal.value) task.addToCalendar = true;
  if (rec.value) task.recurrence = rec.value;
  let durationMin = dur.value;

  const found = parseDates(text, ctx);
  const first = found[0];
  if (first) {
    const { hasTime } = first;
    const { start, end } = resolveWhen(first, ctx.timezone);

    const before = text.slice(0, first.index);
    const deadlineWord = /\b(?:due|by|before|until|till|deadline)\s*$/i.test(before);
    const relative = /^in\s|from now|^within\s/i.test(first.text);

    if (hasTime && !deadlineWord && !relative) {
      task.fixedStart = start;
      task.fixedEnd = end ?? start + (durationMin ?? DEFAULT_APPOINTMENT_MIN) * MIN;
      durationMin = Math.round((task.fixedEnd - task.fixedStart) / MIN);
    } else if (hasTime) {
      task.dueAt = start;
    } else {
      task.dueAt = endOfDayTz(start, ctx.timezone);
    }

    // remove matched phrases back to front so earlier indexes stay valid
    for (const r of [...found].reverse()) {
      text = text.slice(0, r.index) + ' ' + text.slice(r.index + r.text.length);
    }
  }

  if (durationMin !== undefined) task.durationMin = durationMin;
  task.title = tidyTitle(text);
  if (!task.category) {
    const inferred = inferCategory(task.title);
    if (inferred) task.category = inferred;
  }
  return task;
}

const startsWithVerb = (s: string): boolean => TASK_VERBS.has(s.trim().split(/\s+/)[0]?.toLowerCase() ?? '');

/** Splits a line at commas and at "and" when the right side looks like a new task. */
function splitLine(line: string, ctx: ParseContext): string[] {
  const out: string[] = [];
  for (const part of line.split(/\s*,\s*/)) {
    const joiner = /\s+(?:and|then|also|&|plus)\s+/gi;
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = joiner.exec(part))) {
      const right = part.slice(m.index + m[0].length);
      // "salt and pepper" stays whole; "gym and call mom" splits
      if (startsWithVerb(right) || parseDates(right, ctx).length > 0) {
        out.push(part.slice(last, m.index));
        last = m.index + m[0].length;
      }
    }
    out.push(part.slice(last));
  }
  return out.map((s) => s.trim()).filter(Boolean);
}

/**
 * Turns free text into tasks or a command. Fragments that carry only attributes
 * ("about 2 hours", "high priority") are glued back onto the previous task.
 */
export function parseInput(input: string, ctx: ParseContext): ParseResult {
  const trimmed = normalizeMeridiems(input.trim());
  if (!trimmed) return { kind: 'empty' };

  const command = parseCommand(trimmed, ctx);
  if (command) return { kind: 'command', command, raw: trimmed };
  return parseTasksOnly(trimmed, ctx);
}

/** Skips command detection, e.g. when "start the report" turns out to be a new task. */
export function parseTasksOnly(input: string, ctx: ParseContext): ParseResult {
  const trimmed = normalizeMeridiems(input.trim());
  if (!trimmed) return { kind: 'empty' };

  const pieces: string[] = [];
  for (const line of trimmed.split(/\r?\n|;/)) {
    const cleaned = line.trim();
    if (!cleaned) continue;
    for (const part of splitLine(cleaned, ctx)) {
      const parsed = parseTaskPhrase(part, ctx);
      if (!parsed.title && pieces.length > 0) pieces[pieces.length - 1] += `, ${part}`;
      else pieces.push(part);
    }
  }

  const tasks = pieces.map((p) => parseTaskPhrase(p, ctx)).filter((t) => t.title);
  return tasks.length ? { kind: 'tasks', tasks } : { kind: 'empty' };
}

export const ruleBasedUnderstander: TextUnderstander = {
  id: 'rule-based',
  parse: async (input, ctx) => parseInput(input, ctx),
};
