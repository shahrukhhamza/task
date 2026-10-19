import { useCloud } from '../store/cloud';
import { applyChange } from './changeTask';
import { completeTask, deleteTask, editTask, isActive, pushTask, replanAll, setAddToCalendar, startTask, type Undo } from './db/actions';
import { db, ensureProfile } from './db/schema';
import { resolveTarget, type ParsedCommand } from './parser';
import { nextBlock } from './scheduler';
import { formatDayLabel, formatDuration, formatTime, MIN, minutesOfDay } from './time/tz';
import type { Task } from './types';

export type CommandOutcome =
  | { kind: 'done'; message: string; undo?: Undo; taskId?: string }
  | { kind: 'info'; message: string }
  | { kind: 'clarify'; question: string; options: Array<{ label: string; run: () => Promise<CommandOutcome> }> }
  /** `soft`: the sentence may just be a new task ("make dinner at 8"), so the caller can add it instead. */
  | { kind: 'notFound'; message: string; target: string; soft?: boolean };

const VERB: Record<'push' | 'finish' | 'start' | 'delete' | 'calendar' | 'update', string> = {
  update: 'change',
  push: 'move',
  finish: 'finish',
  start: 'start',
  delete: 'delete',
  calendar: 'add to your calendar',
};

async function act(command: Extract<ParsedCommand, { target: string }>, task: Task): Promise<CommandOutcome> {
  const { timezone } = await ensureProfile();
  switch (command.kind) {
    case 'finish':
      return { kind: 'done', message: `Marked "${task.title}" as done.`, undo: await completeTask(task.id), taskId: task.id };
    case 'start':
      return { kind: 'done', message: `Started "${task.title}".`, undo: await startTask(task.id), taskId: task.id };
    case 'delete':
      return { kind: 'done', message: `Deleted "${task.title}".`, undo: await deleteTask(task.id), taskId: task.id };
    case 'calendar': {
      const undo = await setAddToCalendar(task.id, true);
      const connected = useCloud.getState().google === 'connected';
      return {
        kind: 'done',
        message: connected
          ? `Adding "${task.title}" to Google Calendar.`
          : `"${task.title}" is marked for your calendar. Connect Google in Settings to sync it, or open the task for a calendar link.`,
        undo,
        taskId: task.id,
      };
    }
    case 'update': {
      let change = command.change;
      const at = task.fixedStart !== undefined ? minutesOfDay(task.fixedStart, timezone) : undefined;
      // "from 6 to 7": if the task is at 6, it moves to 7; if not, the user is giving its new range
      if (change.asRange && !(at !== undefined && change.fromMin !== undefined && at % 720 === change.fromMin % 720)) {
        change = { ...change, startMin: change.asRange.startMin, endMin: change.asRange.endMin };
      }
      const applied = applyChange(task, change, timezone, Date.now());
      if (!Object.keys(applied.changes).length) return { kind: 'info', message: applied.message };
      return { kind: 'done', message: applied.message, undo: await editTask(task.id, applied.changes, applied.rescheduled), taskId: task.id };
    }
    case 'push': {
      const undo = await pushTask(task.id, command.to, command.hasTime);
      const when = command.hasTime
        ? `${formatDayLabel(command.to, timezone, Date.now())} at ${formatTime(command.to, timezone)}`
        : formatDayLabel(command.to, timezone, Date.now());
      return { kind: 'done', message: `Moved "${task.title}" to ${when.toLowerCase()}.`, undo, taskId: task.id };
    }
  }
}

export interface RunOptions {
  /** The task the user was just talking about, so "delete this" and "mark it done" know what they mean. */
  contextTaskId?: string;
}

/** "this", "it", "that one", "the last one": words that point at the task in play instead of naming one. */
export const isPronounTarget = (target: string): boolean =>
  /^(?:this|that|it|these|those)(?:\s+(?:one|task|meeting|event|appointment|reminder))?$|^(?:the\s+)?(?:last|latest|same|new|previous)(?:\s+(?:one|task|meeting))?$/i.test(
    target.trim(),
  );

function ask(command: Extract<ParsedCommand, { target: string }>, candidates: Task[]): CommandOutcome {
  return {
    kind: 'clarify',
    question: `Which one do you want to ${VERB[command.kind]}?`,
    options: candidates.map((task) => ({ label: task.title, run: () => act(command, task) })),
  };
}

/** Resolves the command's target against existing tasks, asking when it is ambiguous. */
export async function runCommand(command: ParsedCommand, opts: RunOptions = {}): Promise<CommandOutcome> {
  const { timezone } = await ensureProfile();

  switch (command.kind) {
    case 'late': {
      const result = await replanAll({ lateMinutes: command.minutes ?? 0 });
      const risks = result.plan.risks.filter((r) => r.kind === 'miss');
      const lead = command.minutes
        ? `Pushed your plan back ${formatDuration(command.minutes)} and re-packed the day.`
        : 'Re-packed the rest of your day from now.';
      return risks.length
        ? { kind: 'info', message: `${lead} Heads up: ${risks[0].message}` }
        : { kind: 'done', message: lead };
    }

    case 'next': {
      const tasks = await db.tasks.toArray();
      const blocks = tasks.filter(isActive).flatMap((t) => t.blocks);
      const now = Date.now();
      const next = nextBlock({ blocks }, now);
      if (!next) return { kind: 'info', message: 'Nothing else is planned. Add a task or enjoy the free time.' };
      const title = tasks.find((t) => t.id === next.block.taskId)?.title ?? 'a task';
      if (next.inProgress) {
        return { kind: 'info', message: `Right now: "${title}" until ${formatTime(next.block.end, timezone)}.` };
      }
      const mins = Math.round((next.block.start - now) / MIN);
      return { kind: 'info', message: `Next up: "${title}" at ${formatTime(next.block.start, timezone)} (in ${formatDuration(mins)}).` };
    }

    default: {
      const all = (await db.tasks.toArray()).filter((t) => !t.deletedAt);
      const pool = command.kind === 'delete' ? all.filter((t) => t.status !== 'dropped') : all.filter(isActive);
      const fromMin = command.kind === 'update' ? command.change.fromMin : undefined;
      // tasks sitting at the time the user said they are at now ("from 6 pm to 7 pm")
      const atThatTime = fromMin === undefined ? [] : pool.filter((t) => t.fixedStart !== undefined && minutesOfDay(t.fixedStart, timezone) % 720 === fromMin % 720);

      if (!command.target || isPronounTarget(command.target)) {
        const inPlay = opts.contextTaskId ? pool.find((t) => t.id === opts.contextTaskId) : undefined;
        if (atThatTime.length === 1) return act(command, atThatTime[0]);
        if (inPlay) return act(command, inPlay);
        if (atThatTime.length > 1) return ask(command, atThatTime);
        return { kind: 'notFound', target: command.target, message: 'Which task do you mean? Tell me its name.' };
      }
      const found = resolveTarget(command.target, pool);

      if (found.kind === 'none') {
        return {
          kind: 'notFound',
          target: command.target,
          message: command.kind === 'update' ? `I couldn't find “${command.target}” to update. Say “add ${command.target}” to create it.` : `I couldn't find a task matching "${command.target}".`,
          soft: command.kind === 'update' ? command.soft : undefined,
        };
      }
      if (found.kind === 'ambiguous') {
        const sameTime = found.candidates.filter((t) => atThatTime.some((a) => a.id === t.id));
        if (sameTime.length === 1) return act(command, sameTime[0]);
        return ask(command, found.candidates);
      }
      return act(command, found.task);
    }
  }
}
