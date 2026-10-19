// Turns Gemini's JSON into Dayflow's own types, defensively: anything malformed is
// dropped or clamped rather than trusted.

import type { ParseContext, ParsedCommand, ParsedTask, ParseResult } from '../parser';
import { endOfDayTz, fromLocalInput, MIN, startOfDayTz } from '../time/tz';
import type { Priority, Recurrence } from '../types';
import type { Schema } from '../../../supabase/functions/_shared/gemini.ts';

export interface AiTask {
  title?: string;
  kind?: 'flexible' | 'deadline' | 'fixed';
  date?: string | null;
  time?: string | null;
  endTime?: string | null;
  durationMin?: number | null;
  priority?: string;
  category?: string;
  repeat?: { freq?: string; interval?: number | null; days?: number[] | null } | null;
  addToCalendar?: boolean | null;
}

export interface AiParse {
  intent?: 'tasks' | 'command' | 'habit' | 'none';
  tasks?: AiTask[] | null;
  command?: { action?: string; target?: string | null; date?: string | null; time?: string | null; minutes?: number | null } | null;
  habit?: { title?: string; days?: number[] | null } | null;
  reply?: string | null;
}

const CATEGORIES = ['general', 'study', 'work', 'fitness', 'health', 'finance', 'social', 'home', 'personal'];

export const PARSE_SCHEMA: Schema = {
  type: 'OBJECT',
  properties: {
    intent: { type: 'STRING', enum: ['tasks', 'command', 'habit', 'none'] },
    tasks: {
      type: 'ARRAY',
      nullable: true,
      items: {
        type: 'OBJECT',
        properties: {
          title: { type: 'STRING', description: 'Short task name without dates, times or durations.' },
          kind: { type: 'STRING', enum: ['flexible', 'deadline', 'fixed'] },
          date: { type: 'STRING', nullable: true, description: 'YYYY-MM-DD in the user’s timezone' },
          time: { type: 'STRING', nullable: true, description: 'HH:MM, 24-hour' },
          endTime: { type: 'STRING', nullable: true, description: 'HH:MM, 24-hour, fixed tasks only' },
          durationMin: { type: 'INTEGER', nullable: true },
          priority: { type: 'STRING', enum: ['high', 'med', 'low'] },
          category: { type: 'STRING', enum: CATEGORIES },
          repeat: {
            type: 'OBJECT',
            nullable: true,
            properties: {
              freq: { type: 'STRING', enum: ['daily', 'weekly', 'monthly'] },
              interval: { type: 'INTEGER', nullable: true },
              days: { type: 'ARRAY', nullable: true, items: { type: 'INTEGER' }, description: '0 = Sunday … 6 = Saturday' },
            },
            required: ['freq'],
          },
          addToCalendar: { type: 'BOOLEAN', nullable: true },
        },
        required: ['title', 'kind', 'priority', 'category'],
      },
    },
    command: {
      type: 'OBJECT',
      nullable: true,
      properties: {
        action: { type: 'STRING', enum: ['push', 'finish', 'start', 'late', 'next', 'delete', 'calendar'] },
        target: { type: 'STRING', nullable: true, description: 'Title of the existing task it refers to' },
        date: { type: 'STRING', nullable: true },
        time: { type: 'STRING', nullable: true },
        minutes: { type: 'INTEGER', nullable: true },
      },
      required: ['action'],
    },
    habit: {
      type: 'OBJECT',
      nullable: true,
      properties: { title: { type: 'STRING' }, days: { type: 'ARRAY', nullable: true, items: { type: 'INTEGER' } } },
      required: ['title'],
    },
    reply: { type: 'STRING', nullable: true, description: 'One short friendly sentence, only when intent is none' },
  },
  required: ['intent'],
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]?\d|2[0-3]):[0-5]\d$/;

const at = (date: string, time: string, tz: string) => fromLocalInput(`${date}T${time.padStart(5, '0')}`, tz);
const dayEnd = (date: string, tz: string) => {
  const noon = fromLocalInput(`${date}T12:00`, tz);
  return noon === undefined ? undefined : endOfDayTz(noon, tz);
};

function toRecurrence(r: AiTask['repeat']): Recurrence | undefined {
  if (!r || !['daily', 'weekly', 'monthly'].includes(r.freq ?? '')) return undefined;
  const days = (r.days ?? []).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6);
  return {
    freq: r.freq as Recurrence['freq'],
    interval: Math.max(1, Math.min(30, Math.round(r.interval ?? 1))),
    ...(r.freq === 'weekly' && days.length ? { byDay: [...new Set(days)].sort() } : {}),
  };
}

export function toParsedTask(t: AiTask, ctx: ParseContext): ParsedTask | null {
  const title = (t.title ?? '').replace(/\s+/g, ' ').trim().slice(0, 120);
  if (!title) return null;
  const task: ParsedTask = { raw: title, title: title.charAt(0).toUpperCase() + title.slice(1) };

  const priority = t.priority === 'high' || t.priority === 'low' ? (t.priority as Priority) : t.priority === 'med' ? 'med' : undefined;
  if (priority && priority !== 'med') task.priority = priority;
  const category = (t.category ?? '').toLowerCase();
  if (category && category !== 'general' && CATEGORIES.includes(category)) task.category = category;
  if (t.durationMin && t.durationMin > 0) task.durationMin = Math.max(5, Math.min(720, Math.round(t.durationMin / 5) * 5));
  if (t.addToCalendar) task.addToCalendar = true;
  const recurrence = toRecurrence(t.repeat);
  if (recurrence) task.recurrence = recurrence;

  const date = t.date && DATE.test(t.date) ? t.date : undefined;
  const time = t.time && TIME.test(t.time) ? t.time : undefined;

  if (t.kind === 'fixed' && time) {
    const day = date ?? new Date(ctx.now).toLocaleDateString('en-CA', { timeZone: ctx.timezone });
    const start = at(day, time, ctx.timezone);
    if (start !== undefined) {
      let end = t.endTime && TIME.test(t.endTime) ? at(day, t.endTime, ctx.timezone) : undefined;
      if (end === undefined || end <= start) end = start + (task.durationMin ?? 60) * MIN;
      task.fixedStart = start;
      task.fixedEnd = end;
      task.durationMin = Math.round((end - start) / MIN);
      return task;
    }
  }
  if (date) {
    const due = time ? at(date, time, ctx.timezone) : dayEnd(date, ctx.timezone);
    if (due !== undefined) task.dueAt = due;
  }
  return task;
}

function toCommand(c: NonNullable<AiParse['command']>, ctx: ParseContext): ParsedCommand | null {
  const target = (c.target ?? '').trim();
  switch (c.action) {
    case 'late':
      return { kind: 'late', minutes: c.minutes && c.minutes > 0 ? Math.min(600, Math.round(c.minutes)) : undefined };
    case 'next':
      return { kind: 'next' };
    case 'finish':
    case 'start':
    case 'delete':
    case 'calendar':
      return target ? { kind: c.action, target } : null;
    case 'push': {
      if (!target || !c.date || !DATE.test(c.date)) return null;
      const hasTime = !!c.time && TIME.test(c.time);
      const to = hasTime ? at(c.date, c.time as string, ctx.timezone) : (() => {
        const noon = at(c.date as string, '12:00', ctx.timezone);
        return noon === undefined ? undefined : startOfDayTz(noon, ctx.timezone);
      })();
      return to === undefined ? null : { kind: 'push', target, to, hasTime };
    }
    default:
      return null;
  }
}

/** Gemini's answer as a normal parse result, plus a habit or a reply when relevant. */
export type AiParseResult = ParseResult | { kind: 'habit'; habit: { title: string; days: number[] } } | { kind: 'reply'; text: string };

export function toParseResult(ai: AiParse, ctx: ParseContext, raw: string): AiParseResult {
  if (ai.intent === 'command' && ai.command) {
    const command = toCommand(ai.command, ctx);
    if (command) return { kind: 'command', command, raw };
  }
  if (ai.intent === 'habit' && ai.habit?.title?.trim()) {
    const days = (ai.habit.days ?? []).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6);
    return { kind: 'habit', habit: { title: ai.habit.title.trim().slice(0, 80), days: days.length ? [...new Set(days)].sort() : [0, 1, 2, 3, 4, 5, 6] } };
  }
  const tasks = (ai.tasks ?? []).map((t) => toParsedTask(t, ctx)).filter((t): t is ParsedTask => !!t);
  if (tasks.length) return { kind: 'tasks', tasks };
  if (ai.reply?.trim()) return { kind: 'reply', text: ai.reply.trim().slice(0, 240) };
  return { kind: 'empty' };
}
