import { useCloud } from '../store/cloud';
import { completeTask, deleteTask, isActive, pushTask, replanAll, setAddToCalendar, startTask, type Undo } from './db/actions';
import { db, ensureProfile } from './db/schema';
import { resolveTarget, type ParsedCommand } from './parser';
import { nextBlock } from './scheduler';
import { formatDayLabel, formatDuration, formatTime, MIN } from './time/tz';
import type { Task } from './types';

export type CommandOutcome =
  | { kind: 'done'; message: string; undo?: Undo; taskId?: string }
  | { kind: 'info'; message: string }
  | { kind: 'clarify'; question: string; options: Array<{ label: string; run: () => Promise<CommandOutcome> }> }
  | { kind: 'notFound'; message: string; target: string };

const VERB: Record<'push' | 'finish' | 'start' | 'delete' | 'calendar', string> = {
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
      if (isPronounTarget(command.target)) {
        const inPlay = opts.contextTaskId ? pool.find((t) => t.id === opts.contextTaskId) : undefined;
        if (inPlay) return act(command, inPlay);
        return { kind: 'notFound', target: command.target, message: 'Which task do you mean? Tell me its name.' };
      }
      const found = resolveTarget(command.target, pool);

      if (found.kind === 'none') {
        return { kind: 'notFound', target: command.target, message: `I couldn't find a task matching "${command.target}".` };
      }
      if (found.kind === 'ambiguous') {
        return {
          kind: 'clarify',
          question: `Which one do you want to ${VERB[command.kind]}?`,
          options: found.candidates.map((task) => ({ label: task.title, run: () => act(command, task) })),
        };
      }
      return act(command, found.task);
    }
  }
}
