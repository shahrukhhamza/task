import type { ParsedTask } from '../parser';
import { nextOccurrence } from '../recurrence';
import { statsFromTasks, defaultEstimateMin, replan, collectFixed, overlaps, type EstimateStats, type ReplanResult, type SchedulerInput } from '../scheduler';
import { addDaysTz, endOfDayTz, MIN, startOfDayTz } from '../time/tz';
import type { Block, Profile, Task, TaskEvent, TaskEventType } from '../types';
import { db, ensureProfile, newId } from './schema';

const ACTIVE = new Set(['todo', 'scheduled', 'doing']);
export const isActive = (t: Task): boolean => !t.deletedAt && ACTIVE.has(t.status);

export type Undo = () => Promise<void>;

// ------------------------------------------------------------------ loading

export async function loadEstimateStats(): Promise<EstimateStats> {
  return statsFromTasks(await db.tasks.where('status').equals('done').toArray());
}

export async function loadPlannerInput(now = Date.now()): Promise<SchedulerInput> {
  const [tasks, fixedEvents, profile, estimates] = await Promise.all([
    db.tasks.toArray(),
    db.fixedEvents.toArray(),
    ensureProfile(),
    loadEstimateStats(),
  ]);
  return { tasks: tasks.filter((t) => !t.deletedAt), fixedEvents, profile, now, estimates };
}

// ------------------------------------------------------------------ planning

/**
 * Re-runs the planner and stores each task's blocks. Called after every change,
 * and with `lateMinutes` for "I'm running late".
 */
export async function replanAll(opts: { lateMinutes?: number; now?: number } = {}): Promise<ReplanResult> {
  const input = await loadPlannerInput(opts.now);
  const result = replan(input, undefined, opts.lateMinutes ?? 0);

  const byTask = new Map<string, Block[]>();
  for (const b of result.plan.blocks) byTask.set(b.taskId, [...(byTask.get(b.taskId) ?? []), b]);

  const todayStart = startOfDayTz(input.now, input.profile.timezone);
  const updates: Task[] = [];
  for (const task of input.tasks) {
    if (!isActive(task) || task.fixedStart !== undefined) continue;
    const blocks = byTask.get(task.id) ?? [];
    const status = task.status === 'doing' ? 'doing' : blocks.length ? 'scheduled' : 'todo';
    // a block from an earlier day that never got done means the task rolls into today
    const carriedOverAt = task.blocks.some((b) => b.end <= todayStart) ? input.now : task.carriedOverAt;
    if (JSON.stringify(blocks) === JSON.stringify(task.blocks) && status === task.status && carriedOverAt === task.carriedOverAt) continue;
    updates.push({ ...task, blocks, status, carriedOverAt, updatedAt: Date.now(), syncState: 'dirty' });
  }
  if (updates.length) await db.tasks.bulkPut(updates);
  return result;
}

/**
 * Re-planning reads four tables and writes back, which is most of the time an action takes. When a
 * caller that wants a fast answer (the voice assistant) asks for it, actions answer first and the
 * re-plan finishes in the background; `planSettled()` waits for it before anything reads the plan.
 */
let background = false;
let pendingReplan: Promise<unknown> = Promise.resolve();

export async function replanSoon(): Promise<void> {
  if (background) {
    pendingReplan = pendingReplan.then(() => replanAll()).catch(() => undefined);
    return;
  }
  await replanAll();
}

/** Resolves once any background re-plan has finished. */
export const planSettled = (): Promise<unknown> => pendingReplan;

/** Runs `fn` with re-planning moved off its critical path. */
export async function withBackgroundReplan<T>(fn: () => Promise<T>): Promise<T> {
  background = true;
  try {
    return await fn();
  } finally {
    background = false;
  }
}

// ------------------------------------------------------------------ events & undo

async function logEvent(taskId: string, type: TaskEventType, extra: Partial<TaskEvent> = {}): Promise<void> {
  await db.taskEvents.add({ id: newId(), taskId, type, at: Date.now(), ...extra });
}

/** Runs a change and returns a function that restores the touched tasks. */
async function withUndo(taskIds: string[], change: () => Promise<void>): Promise<Undo> {
  const before = (await db.tasks.bulkGet(taskIds)).filter((t): t is Task => !!t);
  const startedAt = Date.now();
  await change();
  return async () => {
    await db.tasks.bulkPut(before.map((t) => ({ ...t, updatedAt: Date.now(), syncState: 'dirty' as const })));
    const created = taskIds.filter((id) => !before.some((t) => t.id === id));
    if (created.length) await db.tasks.bulkDelete(created);
    await db.taskEvents.where('taskId').anyOf(taskIds).filter((e) => e.at >= startedAt).delete();
    await replanSoon();
  };
}

const patch = async (id: string, changes: Partial<Task>): Promise<void> => {
  await db.tasks.update(id, { ...changes, updatedAt: Date.now(), syncState: 'dirty' });
};

// ------------------------------------------------------------------ creating

export function taskFromParsed(p: ParsedTask, now: number): Task {
  const category = p.category ?? 'general';
  return {
    id: newId(),
    title: p.title,
    category,
    priority: p.priority ?? 'med',
    dueAt: p.dueAt,
    fixedStart: p.fixedStart,
    fixedEnd: p.fixedEnd,
    estimateMin: p.durationMin ?? defaultEstimateMin(p.category),
    spentMin: 0,
    status: 'todo',
    recurrence: p.recurrence,
    addToCalendar: p.addToCalendar,
    blocks: [],
    createdAt: now,
    updatedAt: now,
    syncState: 'dirty',
  };
}

export async function addParsedTasks(parsed: ParsedTask[]): Promise<{ tasks: Task[]; undo: Undo }> {
  const now = Date.now();
  const tasks = parsed.filter((p) => p.title.trim()).map((p) => taskFromParsed(p, now));
  const undo = await withUndo(tasks.map((t) => t.id), async () => {
    // two independent writes: no reason to wait for one before starting the other
    await Promise.all([
      db.tasks.bulkAdd(tasks),
      db.taskEvents.bulkAdd(tasks.map((t) => ({ id: newId(), taskId: t.id, type: 'created' as const, at: now, category: t.category }))),
    ]);
  });
  await replanSoon();
  return { tasks, undo };
}

// ------------------------------------------------------------------ status changes

export async function startTask(id: string): Promise<Undo> {
  const undo = await withUndo([id], async () => {
    await patch(id, { status: 'doing' });
    await logEvent(id, 'started');
  });
  await replanSoon();
  return undo;
}

export async function completeTask(id: string): Promise<Undo> {
  const task = await db.tasks.get(id);
  if (!task) return async () => {};
  const now = Date.now();
  const { timezone } = await ensureProfile();

  // measure the real duration when the task was started with the timer or the Start button
  let spentMin = task.spentMin;
  if (spentMin === 0 && task.status === 'doing') {
    const started = await db.taskEvents.where('taskId').equals(id).filter((e) => e.type === 'started').last();
    if (started) spentMin = Math.min(480, Math.round((now - started.at) / MIN));
  }

  const spawned: Task[] = [];
  if (task.recurrence) {
    const next = nextOccurrence(task, now, timezone);
    if (next) {
      spawned.push({
        ...task,
        ...next,
        id: newId(),
        status: 'todo',
        blocks: [],
        spentMin: 0,
        completedAt: undefined,
        calendarEventId: undefined,
        createdAt: now,
        updatedAt: now,
        syncState: 'dirty',
      });
    }
  }

  const undo = await withUndo([id, ...spawned.map((t) => t.id)], async () => {
    await patch(id, { status: 'done', completedAt: now, spentMin, blocks: [] });
    if (spawned.length) await db.tasks.bulkAdd(spawned);
    await logEvent(id, 'completed', { category: task.category, durationMin: spentMin || undefined });
  });
  await replanSoon();
  return undo;
}

/** Skipping pushes a flexible task to tomorrow; an appointment is simply marked skipped. */
export async function skipTask(id: string): Promise<Undo> {
  const task = await db.tasks.get(id);
  if (!task) return async () => {};
  const { timezone } = await ensureProfile();
  const tomorrow = startOfDayTz(addDaysTz(Date.now(), 1, timezone), timezone);

  const undo = await withUndo([id], async () => {
    if (task.fixedStart !== undefined) await patch(id, { status: 'skipped' });
    else await patch(id, { startAfter: tomorrow, blocks: [], status: 'todo' });
    await logEvent(id, 'skipped');
  });
  await replanSoon();
  return undo;
}

export async function deleteTask(id: string): Promise<Undo> {
  const undo = await withUndo([id], async () => {
    await patch(id, { deletedAt: Date.now(), blocks: [] });
    await logEvent(id, 'dropped');
  });
  await replanSoon();
  return undo;
}

export async function updateTask(id: string, changes: Partial<Task>): Promise<Undo> {
  const undo = await withUndo([id], () => patch(id, changes));
  await replanSoon();
  return undo;
}

/** Changes an existing task (new time, length, name or priority) and re-plans around it. */
export async function editTask(id: string, changes: Partial<Task>, rescheduled: boolean): Promise<Undo> {
  const undo = await withUndo([id], async () => {
    await patch(id, changes);
    if (rescheduled) await logEvent(id, 'rescheduled');
  });
  await replanSoon();
  return undo;
}

/** Applies planner suggestions such as "move X to after the deadline". */
export async function applySuggestion(taskId: string, action: 'move' | 'drop', startAfter?: number): Promise<Undo> {
  const undo = await withUndo([taskId], async () => {
    if (action === 'drop') await patch(taskId, { status: 'dropped', blocks: [] });
    else await patch(taskId, { startAfter, blocks: [] });
    await logEvent(taskId, action === 'drop' ? 'dropped' : 'rescheduled');
  });
  await replanSoon();
  return undo;
}

/** "push gym to tomorrow": flexible tasks wait until that day, appointments move there. */
export async function pushTask(id: string, to: number, hasTime: boolean): Promise<Undo> {
  const task = await db.tasks.get(id);
  if (!task) return async () => {};
  const { timezone } = await ensureProfile();

  const undo = await withUndo([id], async () => {
    if (task.fixedStart !== undefined && task.fixedEnd !== undefined) {
      const length = task.fixedEnd - task.fixedStart;
      let start = to;
      if (!hasTime) {
        const dayShift = Math.round((startOfDayTz(to, timezone) - startOfDayTz(task.fixedStart, timezone)) / 86_400_000);
        start = addDaysTz(task.fixedStart, dayShift, timezone);
      }
      await patch(id, { fixedStart: start, fixedEnd: start + length, blocks: [] });
    } else {
      const startAfter = hasTime ? to : startOfDayTz(to, timezone);
      const dueAt = task.dueAt !== undefined && task.dueAt < startAfter ? endOfDayTz(startAfter, timezone) : task.dueAt;
      await patch(id, { startAfter, dueAt, blocks: [] });
    }
    await logEvent(id, 'rescheduled');
  });
  await replanSoon();
  return undo;
}

// ------------------------------------------------------------------ focus & dragging

export async function addFocusMinutes(id: string, minutes: number): Promise<void> {
  const task = await db.tasks.get(id);
  if (!task || minutes <= 0) return;
  await patch(id, { spentMin: task.spentMin + minutes });
  await logEvent(id, 'focus', { durationMin: minutes, category: task.category });
}

export type MoveResult = { ok: true; undo: Undo } | { ok: false; reason: string };

/** Moves a block by hand. The block becomes locked so the planner keeps it there. */
export async function moveBlock(taskId: string, blockId: string, newStart: number): Promise<MoveResult> {
  const input = await loadPlannerInput();
  const task = input.tasks.find((t) => t.id === taskId);
  const block = task?.blocks.find((b) => b.id === blockId);
  if (!task || !block) return { ok: false, reason: 'That block no longer exists.' };

  const moved = { start: newStart, end: newStart + (block.end - block.start) };
  const clash = collectFixed(input).find((f) => !f.done && overlaps(moved, f));
  if (clash) return { ok: false, reason: `That overlaps "${clash.title}".` };
  const other = input.tasks
    .filter((t) => t.id !== taskId)
    .flatMap((t) => t.blocks.map((b) => ({ b, t })))
    .find(({ b }) => overlaps(moved, b));
  if (other) return { ok: false, reason: `That overlaps "${other.t.title}".` };

  const undo = await withUndo([taskId], async () => {
    const blocks = task.blocks.map((b) => (b.id === blockId ? { ...b, ...moved, id: `${taskId}:${moved.start}`, locked: true } : b));
    await patch(taskId, { blocks });
    await logEvent(taskId, 'rescheduled');
  });
  await replanSoon();
  return { ok: true, undo };
}

/** Dragging an appointment changes its actual time. */
export async function moveFixedTask(taskId: string, newStart: number): Promise<MoveResult> {
  const input = await loadPlannerInput();
  const task = input.tasks.find((t) => t.id === taskId);
  if (!task || task.fixedStart === undefined || task.fixedEnd === undefined) return { ok: false, reason: 'Not an appointment.' };
  const undo = await withUndo([taskId], async () => {
    await patch(taskId, { fixedStart: newStart, fixedEnd: newStart + (task.fixedEnd! - task.fixedStart!) });
    await logEvent(taskId, 'rescheduled');
  });
  await replanSoon();
  return { ok: true, undo };
}

// ------------------------------------------------------------------ data management

export async function exportAll(): Promise<{ json: string; csv: string }> {
  const [tasks, taskEvents, fixedEvents, profile, habits, habitLogs, checkins] = await Promise.all([
    db.tasks.toArray(),
    db.taskEvents.toArray(),
    db.fixedEvents.toArray(),
    db.profile.toArray(),
    db.habits.toArray(),
    db.habitLogs.toArray(),
    db.checkins.toArray(),
  ]);
  const json = JSON.stringify(
    { exportedAt: new Date().toISOString(), version: 2, profile, tasks, taskEvents, fixedEvents, habits, habitLogs, checkins },
    null,
    2,
  );

  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const iso = (ts?: number) => (ts ? new Date(ts).toISOString() : '');
  const rows = [
    ['id', 'title', 'category', 'priority', 'status', 'estimate_min', 'spent_min', 'due_at', 'fixed_start', 'fixed_end', 'created_at', 'completed_at'],
    ...tasks
      .filter((t) => !t.deletedAt)
      .map((t) => [t.id, t.title, t.category, t.priority, t.status, t.estimateMin, t.spentMin, iso(t.dueAt), iso(t.fixedStart), iso(t.fixedEnd), iso(t.createdAt), iso(t.completedAt)]),
  ];
  return { json, csv: rows.map((r) => r.map(esc).join(',')).join('\n') };
}

export async function updateProfile(changes: Partial<Profile>): Promise<void> {
  await ensureProfile();
  await db.profile.update('me', { ...changes, updatedAt: Date.now(), syncState: 'dirty' });
  await replanSoon();
}

/** Flags a task for Google Calendar; the sync loop creates, updates or removes the event. */
export async function setAddToCalendar(id: string, on: boolean): Promise<Undo> {
  return withUndo([id], () => patch(id, { addToCalendar: on }));
}

export async function clearAllData(): Promise<void> {
  await Promise.all([
    db.tasks.clear(),
    db.taskEvents.clear(),
    db.fixedEvents.clear(),
    db.habits.clear(),
    db.habitLogs.clear(),
    db.checkins.clear(),
    db.calendarLinks.clear(),
    db.syncMeta.clear(),
  ]);
}
