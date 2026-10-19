// Every active task gets a number, so "update task 2" or "delete number 3" is unambiguous.
// The order is the one people see: what's coming up first, so today's tasks are 1, 2, 3 ...

import type { Task } from './types';

const ACTIVE = new Set(['todo', 'scheduled', 'doing']);

/** When a task next happens: its appointment, its first planned block, or its deadline. */
function nextTime(t: Task): number {
  if (t.fixedStart !== undefined) return t.fixedStart;
  const first = t.blocks.reduce<number>((min, b) => Math.min(min, b.start), Infinity);
  if (first !== Infinity) return first;
  return t.dueAt ?? Infinity;
}

/** Active tasks in number order: soonest first, then by when they were added. */
export function numberedTasks(tasks: Task[]): Task[] {
  return tasks
    .filter((t) => !t.deletedAt && ACTIVE.has(t.status))
    .sort((a, b) => nextTime(a) - nextTime(b) || a.createdAt - b.createdAt || a.id.localeCompare(b.id));
}

export function numberMap(tasks: Task[]): Map<string, number> {
  return new Map(numberedTasks(tasks).map((t, i) => [t.id, i + 1]));
}

const WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20,
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10,
};

/**
 * The task number in a spoken or typed reference: "2", "#2", "task 2", "number two", "no. 3",
 * "item 4", "the second task", "3rd". Returns undefined when the text is a name instead.
 */
export function parseNumberRef(text: string): number | undefined {
  const t = text.trim().toLowerCase().replace(/^the\s+/, '').replace(/\s+(?:one|task|item|please)$/, '').trim();
  const prefixed = /^(?:#|(?:task|number|num|no\.?|item|todo)\s*#?)\s*(\d{1,3}|[a-z]+)$/.exec(t);
  const body = prefixed ? prefixed[1] : t;
  if (/^\d{1,3}$/.test(body)) return parseInt(body, 10) || undefined;
  const ordinal = /^(\d{1,3})(?:st|nd|rd|th)$/.exec(body);
  if (ordinal) return parseInt(ordinal[1], 10) || undefined;
  // bare number words ("two") only count with a prefix or as an ordinal ("second"), so a task called "One" stays a name
  if (body in WORDS && (prefixed || /(?:st|nd|rd|th)$/.test(body) || /^(?:first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)$/.test(body))) return WORDS[body];
  return undefined;
}
