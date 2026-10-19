// Dayflow's Gemini features. Each one has a deterministic fallback, so the app works
// the same with AI off, offline, or out of free quota; AI only makes it smarter.

import { useCloud } from '../../store/cloud';
import { callFunction, FunctionError } from '../cloud/client';
import type { ParseContext } from '../parser';
import { formatDuration, formatTime } from '../time/tz';
import type { Task } from '../types';
import { asUpdate } from '../updateIntent';
import { PARSE_SCHEMA, toParseResult, type AiParse, type AiParseResult } from './convert';
import { applySpokenChange, applySpokenTimes } from './guard';
import { AiError, chooseModel, generateJson, type JsonRequest } from '../../../supabase/functions/_shared/gemini.ts';
import { aiReady, useAi } from './settings';

/** True when some route to Gemini exists: the user's key, or the server's when signed in. */
export function aiAvailable(): boolean {
  const s = useAi.getState();
  return aiReady(s) || (s.enabled && !!useCloud.getState().user && s.cloud !== 'no');
}

/** React-friendly version of aiAvailable. */
export function useAiAvailable(): boolean {
  const enabled = useAi((s) => s.enabled);
  const key = useAi((s) => s.key);
  const cloud = useAi((s) => s.cloud);
  const signedIn = useCloud((s) => !!s.user);
  return aiReady({ enabled, key }) || (enabled && signedIn && cloud !== 'no');
}

async function askJson<T>(req: JsonRequest): Promise<T> {
  const s = useAi.getState();
  if (!s.enabled) throw new AiError('off');

  if (aiReady(s)) {
    let model = s.model || (await chooseModel(s.key));
    if (model !== s.model) s.update({ model });
    try {
      return await generateJson<T>(s.key, model, req);
    } catch (err) {
      // Google retires model names; pick again once and retry
      if (err instanceof AiError && err.code === 'no_model') {
        model = await chooseModel(s.key);
        s.update({ model });
        return generateJson<T>(s.key, model, req);
      }
      if (err instanceof AiError && err.code === 'invalid_key') s.setError(err.message);
      throw err;
    }
  }

  if (useCloud.getState().user && s.cloud !== 'no') {
    try {
      const { json } = await callFunction<{ json: T }>('ai', { ...req });
      s.setCloud('yes');
      return json;
    } catch (err) {
      if (err instanceof FunctionError) {
        if (err.code === 'not_configured') s.setCloud('no');
        const map: Record<string, AiError['code']> = { rate_limited: 'rate_limited', blocked: 'blocked', network: 'network' };
        throw new AiError(map[err.code] ?? 'bad_response', err.message);
      }
      throw err;
    }
  }
  throw new AiError('off');
}

// ------------------------------------------------------------------ understanding input

function dateContext(ctx: ParseContext): string {
  const fmt = (ts: number, opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-CA', { timeZone: ctx.timezone, ...opts }).format(ts);
  const days = Array.from({ length: 8 }, (_, i) => {
    const ts = ctx.now + i * 86_400_000;
    return `${fmt(ts, { weekday: 'short' })} ${fmt(ts, { year: 'numeric', month: '2-digit', day: '2-digit' })}`;
  });
  return `Now: ${days[0]} ${fmt(ctx.now, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })} (${ctx.timezone}). Next days: ${days.slice(1).join(', ')}.`;
}

const PARSE_RULES = `You are the input layer of Dayflow, a personal day planner. Convert the user's message into JSON for the schema.
Rules:
- intent "tasks": new things to do; one item per task, split lists. "command": acts on an EXISTING task (change its time, length, name or priority → update; postpone to another day → push; done/finished → finish, start, delete/cancel → delete, add to calendar → calendar), says they are late/behind (late, with minutes if given), or asks what's next (next).
- NEVER create a new task when the user is changing one that exists. "update the time of my meeting from 6 to 7", "change the meeting to 7 pm", "make it 30 minutes", "actually move gym to 8", "rename gym to workout" are all command update with target = the existing task's title (or "this" for it/that). For update: time is the NEW start, endTime the NEW end (only if they gave one), minutes the new length, newTitle a new name, fromTime the OLD time ("from 6 to 7" means fromTime 18:00, time 19:00). "habit": a recurring habit to track (e.g. "habit: read daily", "I want to meditate every morning"). "none": nothing actionable; then give a short helpful reply.
- kind "fixed" when it happens at a set time (meeting, class, appointment, "gym at 6pm"); "deadline" when it must be done by a date or time (due, by, before, deadline); otherwise "flexible". A flexible task mentioned for a day ("call mom tomorrow") gets that date.
- Resolve relative dates using the calendar given. Times are 24-hour HH:MM. Respect am/pm exactly: "8 AM to 9PM" is time 08:00 and endTime 21:00, "from 5 am to 6 am" is 05:00 to 06:00, "9 at night" is 21:00, 12 AM is 00:00 and 12 PM is 12:00. A bare hour from 1 to 6 without am/pm means the afternoon. A time already past today, with no date, means tomorrow.
- A message like "add a meeting from 5 to 6" is one fixed task titled "Meeting", never "Add a meeting".
- For a fixed task, endTime is the end the user said ("6 pm to 6:30" is time 18:00, endTime 18:30), and durationMin the length they said ("for half an hour" is 30). Use exactly the length given: never round a short meeting up to an hour. Without any stated end or length, leave endTime and durationMin empty.
- durationMin otherwise only when stated or obvious ("quick call" = 15). Never invent one.
- priority "high" only for urgent/important wording, "low" for whenever/someday/no rush, otherwise "med".
- repeat only for every/daily/weekly/each wording. addToCalendar only if they ask to put it in their calendar.
- When the user says this, it, that or the last one about a task, use target "this" (the app knows which task they mean).
- Titles: short and natural, in the user's own language and script, without dates, times or durations, first letter capitalised.
- Input may be in any language (English, Urdu, Roman Urdu, Hindi, Arabic and more) and may contain voice-typing mistakes; understand the intent.`;

export async function understand(text: string, ctx: ParseContext, existing: Task[]): Promise<AiParseResult> {
  const titles = existing
    .filter((t) => !t.deletedAt && ['todo', 'scheduled', 'doing'].includes(t.status))
    .slice(0, 40)
    .map((t) => `- ${t.title}`)
    .join('\n');
  const ai = await askJson<AiParse>({
    system: `${PARSE_RULES}\n${dateContext(ctx)}\nExisting tasks (copy the closest title as a command target):\n${titles || '- (none)'}`,
    prompt: text,
    schema: PARSE_SCHEMA,
    temperature: 0.1,
  });
  const result = toParseResult(ai, ctx, text);
  if (result.kind === 'command' && result.command.kind === 'update') {
    return { ...result, command: { ...result.command, change: applySpokenChange(result.command.change, text) } };
  }
  if (result.kind !== 'tasks') return result;
  // a task the model made up out of an edit ("change the meeting to 7") becomes that edit
  const edit = asUpdate(result.tasks, text, existing, ctx);
  if (edit) return { kind: 'command', command: edit, raw: text };
  return { ...result, tasks: applySpokenTimes(result.tasks, text, ctx.timezone) };
}

// ------------------------------------------------------------------ break a task down

export interface Step {
  title: string;
  durationMin: number;
}

export async function breakDown(task: Task): Promise<Step[]> {
  const result = await askJson<{ steps?: Array<{ title?: string; durationMin?: number }> }>({
    system:
      'Break the task into 2 to 6 concrete, sequential steps someone can start right away. Each step: a short imperative title (max 8 words) in the same language as the task, and durationMin between 5 and 120. Together the steps should roughly fill the total time given.',
    prompt: `Task: ${task.title}\nCategory: ${task.category}\nTotal time: about ${task.estimateMin} minutes`,
    schema: {
      type: 'OBJECT',
      properties: {
        steps: {
          type: 'ARRAY',
          items: { type: 'OBJECT', properties: { title: { type: 'STRING' }, durationMin: { type: 'INTEGER' } }, required: ['title', 'durationMin'] },
        },
      },
      required: ['steps'],
    },
    temperature: 0.4,
  });
  const steps = (result.steps ?? [])
    .map((s) => ({ title: (s.title ?? '').trim().slice(0, 80), durationMin: Math.max(5, Math.min(120, Math.round((s.durationMin ?? 30) / 5) * 5)) }))
    .filter((s) => s.title);
  if (steps.length < 2) throw new AiError('bad_response', 'No useful steps came back.');
  return steps.slice(0, 6);
}

// ------------------------------------------------------------------ daily brief

export interface DayContext {
  timezone: string;
  now: number;
  items: Array<{ title: string; start: number; end: number; kind: string; priority?: string }>;
  deadlines: Array<{ title: string; dueAt: number }>;
  habits: string[];
  done: number;
  peakStart: number;
  peakEnd: number;
}

export async function dailyBrief(day: DayContext): Promise<string> {
  const lines = [
    `Time now: ${formatTime(day.now, day.timezone)}. Best focus window: ${Math.floor(day.peakStart / 60)}:00 to ${Math.floor(day.peakEnd / 60)}:00.`,
    `Already done today: ${day.done}.`,
    'Plan:',
    ...day.items.map((i) => `- ${formatTime(i.start, day.timezone)} ${i.title} (${formatDuration((i.end - i.start) / 60_000)}, ${i.kind}${i.priority === 'high' ? ', high priority' : ''})`),
    day.deadlines.length ? `Deadlines soon: ${day.deadlines.map((d) => d.title).join(', ')}` : '',
    day.habits.length ? `Habits today: ${day.habits.join(', ')}` : '',
  ];
  const result = await askJson<{ brief?: string }>({
    system:
      'You are Dayflow’s daily coach. Write two short sentences (45 words max) about the user’s day: what to start with and one practical tip based on their plan. Warm and direct, specific to their tasks, no generic motivation, no lists, at most one emoji.',
    prompt: lines.filter(Boolean).join('\n'),
    schema: { type: 'OBJECT', properties: { brief: { type: 'STRING' } }, required: ['brief'] },
    temperature: 0.6,
  });
  const brief = (result.brief ?? '').trim();
  if (!brief) throw new AiError('bad_response');
  return brief.slice(0, 400);
}

// ------------------------------------------------------------------ weekly look

export async function weeklyInsights(summary: string): Promise<string[]> {
  const result = await askJson<{ insights?: string[] }>({
    system:
      'You review one person’s week in a day planner. Give exactly 3 short, specific observations, each with one concrete suggestion, 25 words max each. Base them only on the data; if data is thin, say what to track next.',
    prompt: summary,
    schema: { type: 'OBJECT', properties: { insights: { type: 'ARRAY', items: { type: 'STRING' } } }, required: ['insights'] },
    temperature: 0.5,
  });
  const insights = (result.insights ?? []).map((s) => s.trim()).filter(Boolean).slice(0, 3);
  if (!insights.length) throw new AiError('bad_response');
  return insights;
}
