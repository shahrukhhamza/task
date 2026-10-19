// The brain of the voice assistant: one spoken sentence in, one action and one short
// answer out. It holds just enough conversation state to understand "this", "undo it" and
// "the second one", and nothing else, so it can be tested without a microphone.

import { runCommand, type CommandOutcome } from '../commandRunner';
import { addParsedTasks, isActive, planSettled, withBackgroundReplan, type Undo } from '../db/actions';
import { addHabit } from '../db/habitActions';
import { db, ensureProfile } from '../db/schema';
import { describeDays } from '../habits';
import { parseInput, parseTasksOnly, type ParsedTask, type ParseContext } from '../parser';
import { normalizeMeridiems } from '../parser/spokenTime';
import { numberMap, parseNumberRef } from '../taskNumbers';
import { asUpdate } from '../updateIntent';
import type { AiParseResult } from '../ai/convert';
import { formatDayLabel, formatDuration, formatTime, MIN, startOfDayTz } from '../time/tz';
import type { Task } from '../types';

export interface VoiceTurn {
  /** What the assistant shows. */
  say: string;
  /** A shorter version for speaking aloud, when the screen text carries more than is worth saying. */
  speak?: string;
  tone: 'ok' | 'info' | 'error';
  /** Present when the action can be taken back. */
  undo?: Undo;
  /** Present when the assistant needs the user to choose. */
  options?: string[];
  /** The user asked to stop talking. */
  end?: boolean;
}

export interface AgentDeps {
  /** Turns a sentence into tasks, a command, a habit or a reply (Gemini, with the rule parser as the fallback). */
  understand(text: string, ctx: ParseContext, existing: Task[]): Promise<AiParseResult>;
  /** True when understand() can use Gemini; a command the rules found but could not place is retried there. */
  smart: boolean;
  now(): number;
}

interface PendingChoice {
  labels: string[];
  runs: Array<() => Promise<CommandOutcome>>;
}

const UNDO =
  /^(?:please\s+)?(?:undo(?:\s+(?:that|it|this|the last(?:\s+one)?))?|bring\s+(?:it|that|them)\s+back|restore\s+(?:it|that)|take\s+(?:it|that)\s+back|never\s*mind|cancel\s+that|scratch\s+that|oops)$/i;
const STOP =
  /^(?:stop(?:\s+listening)?|that'?s\s+all(?:\s+for\s+now)?|that\s+will\s+be\s+all|goodbye|good\s*bye|bye(?:\s+bye)?|i'?m\s+done\s+(?:talking|here)|close|exit|go\s+to\s+sleep)$/i;
const AGENDA =
  /^(?:so,?\s+)?(?:what(?:'s|\s+is|\s+does|\s+do\s+i\s+have|\s+have\s+i\s+got)?\s+(?:on\s+)?(?:my\s+)?(?:schedule|agenda|plan|calendar|day)(?:\s+look\s+like)?(?:\s+(?:for\s+)?(today|tomorrow))?|what\s+(?:am\s+i\s+doing|do\s+i\s+have|have\s+i\s+got)(?:\s+on)?\s*(today|tomorrow)?|(?:read|tell\s+me|show\s+me)\s+(?:out\s+)?(?:my\s+)?(?:day|schedule|agenda|plan|tasks)(?:\s+(?:for\s+)?(today|tomorrow))?)\s*\??$/i;
const ORDINALS: Array<[RegExp, number]> = [
  [/\b(?:first|1st|one|1)\b/, 0],
  [/\b(?:second|2nd|two|2)\b/, 1],
  [/\b(?:third|3rd|three|3)\b/, 2],
  [/\b(?:fourth|4th|four|4)\b/, 3],
];

const clean = (text: string) =>
  normalizeMeridiems(text.trim())
    .replace(/[.!?]+$/, '')
    .replace(/\s+/g, ' ');

const list = (items: string[]): string => (items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`);

/** When a task is, in words the user would say. */
export function whenPhrase(task: Pick<Task, 'fixedStart' | 'fixedEnd' | 'dueAt'>, tz: string, now: number): string {
  if (task.fixedStart !== undefined) {
    const day = formatDayLabel(task.fixedStart, tz, now).toLowerCase();
    const end = task.fixedEnd !== undefined && task.fixedEnd > task.fixedStart ? ` to ${formatTime(task.fixedEnd, tz)}` : '';
    return `${day} from ${formatTime(task.fixedStart, tz)}${end}`;
  }
  if (task.dueAt !== undefined) return `due ${formatDayLabel(task.dueAt, tz, now).toLowerCase()}`;
  return '';
}

function overlapWarning(created: Task[], others: Task[]): string {
  for (const t of created) {
    if (t.fixedStart === undefined || t.fixedEnd === undefined) continue;
    const clash = others.find(
      (o) => o.id !== t.id && isActive(o) && o.fixedStart !== undefined && o.fixedEnd !== undefined && o.fixedStart < t.fixedEnd! && t.fixedStart! < o.fixedEnd,
    );
    if (clash) return ` Heads up: that overlaps “${clash.title}”.`;
  }
  return '';
}

export function createVoiceAgent(deps: AgentDeps) {
  let lastTaskId: string | undefined;
  let lastUndo: Undo | undefined;
  let pending: PendingChoice | null = null;

  async function agenda(day: 'today' | 'tomorrow', tz: string): Promise<VoiceTurn> {
    const now = deps.now();
    const base = startOfDayTz(day === 'today' ? now : now + 24 * 60 * MIN, tz);
    const end = startOfDayTz(base + 36 * 60 * MIN, tz);
    const tasks = (await db.tasks.toArray()).filter(isActive);
    const numbers = numberMap(tasks);
    const items = tasks
      .flatMap((t) => {
        const slots = t.fixedStart !== undefined ? [{ start: t.fixedStart, end: t.fixedEnd ?? t.fixedStart }] : t.blocks;
        return slots
          .filter((s) => s.start >= base && s.start < end && (day === 'tomorrow' || s.end > now))
          .map((s) => ({ title: t.title, start: s.start, n: numbers.get(t.id) }));
      })
      .sort((a, b) => a.start - b.start);

    if (!items.length) return { say: day === 'today' ? 'Nothing else is planned for today.' : 'Nothing is planned for tomorrow yet.', tone: 'info' };
    const spoken = items.slice(0, 5).map((i) => `${i.n ? `task ${i.n}, ` : ''}${i.title} at ${formatTime(i.start, tz)}`);
    const more = items.length > 5 ? `, and ${items.length - 5} more` : '';
    return { say: `${day === 'today' ? 'Today' : 'Tomorrow'} you have ${list(spoken)}${more}.`, tone: 'info' };
  }

  async function fromOutcome(outcome: CommandOutcome): Promise<VoiceTurn> {
    if (outcome.kind === 'done') {
      if (outcome.taskId) lastTaskId = outcome.taskId;
      lastUndo = outcome.undo;
      return { say: outcome.message, tone: 'ok', undo: outcome.undo };
    }
    if (outcome.kind === 'info') return { say: outcome.message, tone: 'info' };
    if (outcome.kind === 'clarify') {
      pending = { labels: outcome.options.map((o) => o.label), runs: outcome.options.map((o) => o.run) };
      return { say: `${outcome.question} ${list(pending.labels.map((l) => `“${l}”`))}?`, tone: 'info', options: pending.labels };
    }
    return { say: outcome.message, tone: 'error' };
  }

  /** Matches "the second one" or "gym" against the choices offered last turn. */
  function pickChoice(text: string, choice: PendingChoice): number {
    const t = text.toLowerCase();
    // "number 2", "task 3", "#1": the number shown on the task, not the position in this list
    const wanted = parseNumberRef(t.replace(/^(?:the\s+)?(?:one\s+)?(?:with\s+)?/, ''));
    if (wanted !== undefined && /(?:#|number|task|no\.?|item)\s*\d|^\d+$/.test(t)) {
      const byNumber = choice.labels.findIndex((l) => l.endsWith(`(#${wanted})`));
      if (byNumber >= 0) return byNumber;
    }
    const byName = choice.labels.findIndex((l) => t.includes(l.toLowerCase()) || l.toLowerCase().includes(t));
    if (byName >= 0) return byName;
    if (/\b(?:last)\b/.test(t)) return choice.labels.length - 1;
    for (const [re, index] of ORDINALS) if (re.test(t) && index < choice.labels.length) return index;
    const words = t.split(/\s+/).filter((w) => w.length > 2);
    const scored = choice.labels.map((l) => words.filter((w) => l.toLowerCase().includes(w)).length);
    const best = Math.max(...scored);
    return best > 0 && scored.filter((s) => s === best).length === 1 ? scored.indexOf(best) : -1;
  }

  async function addTasks(tasks: ParsedTask[], tz: string, before: Task[]): Promise<VoiceTurn> {
    const { tasks: created, undo } = await addParsedTasks(tasks);
    if (!created.length) return { say: 'I couldn’t find a task in that. Try “add a meeting from 5 to 6 pm”.', tone: 'error' };
    lastTaskId = created[created.length - 1].id;
    lastUndo = undo;
    const now = deps.now();
    const warn = overlapWarning(created, before);
    // flexible tasks are numbered by where the planner puts them, so wait for it; appointments number by their own time
    if (created.some((t) => t.fixedStart === undefined)) await planSettled();
    const numbers = numberMap(created.some((t) => t.fixedStart === undefined) ? await db.tasks.toArray() : [...before, ...created]);
    const label = (t: Task) => `“${t.title}”${numbers.has(t.id) ? ` (task ${numbers.get(t.id)})` : ''}`;

    if (created.length === 1) {
      const t = created[0];
      const when = whenPhrase(t, tz, now);
      const tail = when ? `, ${when}` : t.fixedStart === undefined ? ` to your day (${formatDuration(t.estimateMin)})` : '';
      return {
        say: `Added ${label(t)}${tail}.${warn}`,
        // out loud, the task number is noise: it is on screen
        speak: `Added ${t.title}${when ? `, ${when}` : ''}.${warn}`,
        tone: 'ok',
        undo,
      };
    }
    return { say: `Added ${created.length} tasks: ${list(created.map(label))}.${warn}`, speak: `Added ${created.length} tasks.${warn}`, tone: 'ok', undo };
  }

  async function act(result: AiParseResult, tz: string, raw: string, existing: Task[]): Promise<VoiceTurn> {
    switch (result.kind) {
      case 'tasks': {
        // "change the meeting to 7 pm" heard as a new task called "Meeting" is an edit of the one that exists
        const edit = asUpdate(result.tasks, raw, existing, { now: deps.now(), timezone: tz });
        if (edit) return fromOutcome(await runCommand(edit, { contextTaskId: lastTaskId }));
        return addTasks(result.tasks, tz, existing);
      }
      case 'command':
        return fromOutcome(await runCommand(result.command, { contextTaskId: lastTaskId }));
      case 'habit': {
        const { undo } = await addHabit({ title: result.habit.title, days: result.habit.days });
        lastUndo = undo;
        return { say: `New habit: “${result.habit.title}”, ${describeDays(result.habit.days).toLowerCase()}.`, tone: 'ok', undo };
      }
      case 'reply':
        return { say: result.text, tone: 'info' };
      default:
        return { say: `Sorry, I didn’t catch a task in “${raw}”. Try “add gym at 6 pm”.`, tone: 'error' };
    }
  }

  return {
    /**
     * Handles one sentence. Never throws; failures come back as an error turn. It answers as soon as
     * the change is saved; re-planning the day finishes in the background, and the next sentence
     * waits for it.
     */
    async hear(rawText: string): Promise<VoiceTurn> {
      const text = clean(rawText);
      if (!text) return { say: '', tone: 'info' };
      await planSettled();
      return withBackgroundReplan(() => handle(text));
    },

    /** Forget "this" and any open question, e.g. when the conversation is closed. */
    reset() {
      lastTaskId = undefined;
      lastUndo = undefined;
      pending = null;
    },

    /** What "this" currently points at, for the UI and tests. */
    get context() {
      return { lastTaskId, hasPending: pending !== null };
    },
  };

  async function handle(text: string): Promise<VoiceTurn> {
    try {
      // read the profile and the tasks together: each database round-trip costs tens of milliseconds
      const [{ timezone }, existing] = await Promise.all([ensureProfile(), db.tasks.toArray()]);
      const ctx: ParseContext = { now: deps.now(), timezone };

      if (STOP.test(text)) return { say: 'Okay, talk to you later.', tone: 'info', end: true };

      if (UNDO.test(text)) {
        if (!lastUndo) return { say: 'There’s nothing to undo yet.', tone: 'info' };
        const undo = lastUndo;
        lastUndo = undefined;
        await undo();
        return { say: 'Done, I’ve put it back.', tone: 'ok' };
      }

      if (pending) {
        const choice = pending;
        pending = null;
        const index = pickChoice(text, choice);
        if (index >= 0) return fromOutcome(await choice.runs[index]());
        // not an answer to the question: treat it as a new request
      }

      const agendaMatch = AGENDA.exec(text);
      if (agendaMatch) {
        const day = (agendaMatch[1] ?? agendaMatch[2] ?? agendaMatch[3] ?? 'today').toLowerCase() as 'today' | 'tomorrow';
        return agenda(day, timezone);
      }

      // Plain commands ("delete this", "push gym to tomorrow") don't need a model; everything else does its best
      const rules = parseInput(text, ctx);
      if (rules.kind === 'command') {
        const outcome = await runCommand(rules.command, { contextTaskId: lastTaskId });
        if (outcome.kind === 'notFound' && outcome.soft) {
          // "make dinner at 8" with no dinner to change: it was a new task all along
          if (deps.smart) return await act(await deps.understand(text, ctx, existing), timezone, text, existing);
          return await act(parseTasksOnly(text, ctx), timezone, text, existing);
        }
        const turn = await fromOutcome(outcome);
        if (turn.tone !== 'error' || !deps.smart) return turn;
      }
      return await act(await deps.understand(text, ctx, existing), timezone, text, existing);
    } catch (err) {
      return { say: `Something went wrong${err instanceof Error && err.message ? `: ${err.message}` : ''}. Please try again.`, tone: 'error' };
    }
  }
}
