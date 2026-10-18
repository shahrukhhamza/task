import { DAY, deadlineLabel, endOfDayTz, formatDuration, MIN, startOfDayTz } from '../time/tz';
import type { Block, Task } from '../types';
import { effortOf, priorityScore, remainingMinutes, type Effort } from './score';
import {
  ceilToGrid,
  collectFixed,
  splitByPeak,
  subtract,
  workWindows,
  type Slot,
} from './slots';
import type {
  DayFeasibility,
  Plan,
  ReplanResult,
  Risk,
  SchedulerInput,
  Suggestion,
} from './types';

const MIN_CHUNK = 20;
const ACTIVE = new Set(['todo', 'scheduled', 'doing']);

const gapAfter = (lengthMin: number, breakMin: number): number =>
  (lengthMin >= 45 ? breakMin : Math.min(5, breakMin)) * MIN;

/** Splits `left` minutes into chunks of at most `maxChunk`, avoiding a tiny trailing piece. */
function chunkTarget(left: number, maxChunk: number): number {
  if (left <= maxChunk) return left;
  if (left < maxChunk + MIN_CHUNK) return Math.ceil(left / 2 / 5) * 5;
  return maxChunk;
}

interface Candidate extends Slot {
  peak: boolean;
}

interface Attempt {
  blocks: Block[];
  unscheduled: Record<string, number>;
  missedMin: number;
}

/** Plans every active task into the free time that is left once fixed commitments are removed. */
export function buildPlan(input: SchedulerInput): Plan {
  const { profile, now } = input;
  const horizon = input.horizonDays ?? 7;
  const from = ceilToGrid(Math.max(now, input.notBefore ?? now));
  const fixed = collectFixed(input);
  const buffer = profile.bufferMin * MIN;

  const tasks = input.tasks.filter(
    (t) => !t.deletedAt && ACTIVE.has(t.status) && t.fixedStart === undefined,
  );

  // blocks the user pinned by hand stay put and use up their share of the task
  const locked: Block[] = tasks.flatMap((t) => t.blocks.filter((b) => b.locked && b.end > from));
  const lockedMinutes = new Map<string, number>();
  for (const b of locked) lockedMinutes.set(b.taskId, (lockedMinutes.get(b.taskId) ?? 0) + (b.end - b.start) / MIN);

  let baseFree: Slot[] = workWindows(profile, now, from, horizon);
  for (const f of fixed) {
    if (!f.done) baseFree = subtract(baseFree, { start: f.start - buffer, end: f.end + buffer });
  }
  for (const b of locked) {
    baseFree = subtract(baseFree, { start: b.start, end: b.end + gapAfter((b.end - b.start) / MIN, profile.breakMin) });
  }

  // focused minutes already committed per day (hand-placed blocks count towards the daily cap)
  const firstDay = startOfDayTz(now, profile.timezone);
  const dayIndexOf = (ts: number) => Math.round((startOfDayTz(ts, profile.timezone) - firstDay) / DAY);
  const baseUsed = new Map<number, number>();
  for (const b of locked) {
    const day = dayIndexOf(b.start);
    baseUsed.set(day, (baseUsed.get(day) ?? 0) + (b.end - b.start) / MIN);
  }

  const work = tasks
    .map((task) => {
      const total = remainingMinutes(task, input.estimates);
      return {
        task,
        total,
        left: Math.max(0, total - (lockedMinutes.get(task.id) ?? 0)),
        effort: effortOf(task, total),
        score: priorityScore(task, now, input.estimates) + (task.status === 'doing' ? 100 : 0),
      };
    })
    .filter((w) => w.left > 0);

  const attemptWith = (boosted: Set<string>): Attempt => {
    const order = [...work].sort((a, b) => {
      const boostA = boosted.has(a.task.id) ? 1 : 0;
      const boostB = boosted.has(b.task.id) ? 1 : 0;
      if (boostA !== boostB) return boostB - boostA;
      return b.score - a.score;
    });

    let free = baseFree;
    const used = new Map(baseUsed);
    const capacity = (day: number) => Math.max(0, profile.maxFocusMin - (used.get(day) ?? 0));
    const blocks: Block[] = [];
    const unscheduled: Record<string, number> = {};
    let missedMin = 0;

    for (const [index, { task, left: initialLeft, effort }] of order.entries()) {
      let left = initialLeft;
      // easy work only avoids the peak window while hard work is still waiting for it
      const protectPeak = order.slice(index + 1).some((w) => w.effort === 'hard');
      const earliest = Math.max(from, task.startAfter ?? 0);
      // overdue tasks are still planned as soon as possible instead of being impossible
      const latest = task.dueAt !== undefined && task.dueAt > from ? task.dueAt : Infinity;

      while (left > 0) {
        const target = chunkTarget(left, profile.maxChunkMin);
        const piece = pickPiece(free, effort, protectPeak, earliest, latest, target, left, capacity);
        if (!piece) break;

        let len = Math.min(target, piece.len);
        if (left - len > 0 && left - len < MIN_CHUNK && piece.len >= left) len = left;
        used.set(piece.day, (used.get(piece.day) ?? 0) + len);
        const block: Block = {
          id: `${task.id}:${piece.start}`,
          taskId: task.id,
          start: piece.start,
          end: piece.start + len * MIN,
          chunk: 1,
          chunks: 1,
        };
        blocks.push(block);
        free = subtract(free, { start: block.start, end: block.end + gapAfter(len, profile.breakMin) });
        left -= len;
      }

      if (left > 0) {
        unscheduled[task.id] = left;
        if (task.dueAt !== undefined) missedMin += left;
      }
    }
    return { blocks, unscheduled, missedMin };
  };

  // Greedy-by-score can starve a deadline, so retry with missed tasks promoted.
  const boosted = new Set<string>();
  let best = attemptWith(boosted);
  for (let i = 0; i < 3 && best.missedMin > 0; i++) {
    const before = boosted.size;
    for (const w of work) {
      if (w.task.dueAt !== undefined && (best.unscheduled[w.task.id] ?? 0) > 0) boosted.add(w.task.id);
    }
    if (boosted.size === before) break;
    const next = attemptWith(boosted);
    if (next.missedMin < best.missedMin) best = next;
  }

  const blocks = numberChunks([...locked, ...best.blocks]);
  const plan: Plan = { blocks, fixed, risks: [], unscheduled: best.unscheduled, generatedAt: now };
  plan.risks = findRisks(input, tasks, plan);
  return plan;
}

/** Picks where the next chunk goes: earliest day first, and within a day the zone that suits the effort. */
function pickPiece(
  free: Slot[],
  effort: Effort,
  protectPeak: boolean,
  earliest: number,
  latest: number,
  target: number,
  left: number,
  capacity: (day: number) => number,
): { start: number; len: number; day: number } | undefined {
  const needed = Math.min(MIN_CHUNK, left);
  const rank = (c: Candidate): number => {
    if (effort === 'hard') return c.peak ? 0 : 1;
    if (effort === 'easy' && protectPeak) return c.peak ? 1 : 0;
    return 0;
  };

  const candidates: Array<Candidate & { len: number }> = [];
  for (const slot of free) {
    for (const piece of splitByPeak(slot)) {
      const start = ceilToGrid(Math.max(piece.start, earliest));
      const end = Math.min(piece.end, latest);
      const len = Math.floor(Math.min((end - start) / MIN, capacity(piece.day)) / 5) * 5;
      if (len >= needed) candidates.push({ ...piece, start, end, len });
    }
  }
  candidates.sort((a, b) => a.day - b.day || rank(a) - rank(b) || a.start - b.start);

  // within the earliest day that has room, prefer a spot that holds the whole chunk so tasks fragment less
  const earliestDay = candidates.filter((c) => c.day === candidates[0]?.day);
  const chosen = earliestDay.find((c) => c.len >= target) ?? earliestDay[0];
  return chosen && { start: chosen.start, len: chosen.len, day: chosen.day };
}

function numberChunks(blocks: Block[]): Block[] {
  const sorted = [...blocks].sort((a, b) => a.start - b.start);
  const counts = new Map<string, number>();
  for (const b of sorted) counts.set(b.taskId, (counts.get(b.taskId) ?? 0) + 1);
  const seen = new Map<string, number>();
  return sorted.map((b) => {
    const index = (seen.get(b.taskId) ?? 0) + 1;
    seen.set(b.taskId, index);
    return { ...b, chunk: index, chunks: counts.get(b.taskId) ?? 1 };
  });
}

// ------------------------------------------------------------------ risks

function findRisks(input: SchedulerInput, tasks: Task[], plan: Plan): Risk[] {
  const { now, profile } = input;
  const risks: Risk[] = [];

  for (const task of tasks) {
    if (task.dueAt === undefined) continue;
    const shortfall = plan.unscheduled[task.id] ?? 0;
    const label = deadlineLabel(task.dueAt, profile.timezone, now);

    if (task.dueAt < now) {
      risks.push({
        taskId: task.id,
        kind: 'overdue',
        message: `"${task.title}" is overdue. It was due ${label.replace(/'s$/, '')}.`,
        shortfallMin: shortfall,
        suggestions: [],
      });
    } else if (shortfall > 0) {
      risks.push({
        taskId: task.id,
        kind: 'miss',
        message: `At this pace you'll miss ${label} deadline for "${task.title}" (${formatDuration(shortfall)} won't fit).`,
        shortfallMin: shortfall,
        suggestions: suggestionsFor(task, shortfall, tasks, plan, input),
      });
    }
  }
  return risks.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'overdue' ? -1 : 1));
}

/** Frees time by moving or dropping lower-ranked work that is occupying slots before the deadline. */
function suggestionsFor(task: Task, shortfall: number, tasks: Task[], plan: Plan, input: SchedulerInput): Suggestion[] {
  const dueAt = task.dueAt as number;
  const stats = input.estimates;
  const candidates = tasks
    .filter((t) => t.id !== task.id && (t.dueAt === undefined || t.dueAt > dueAt))
    .map((t) => ({
      task: t,
      minutes: plan.blocks
        .filter((b) => b.taskId === t.id && b.start < dueAt && !b.locked)
        .reduce((sum, b) => sum + (b.end - b.start) / MIN, 0),
      score: priorityScore(t, input.now, stats),
    }))
    .filter((c) => c.minutes > 0)
    .sort((a, b) => a.score - b.score);

  const out: Suggestion[] = [];
  let freed = 0;
  for (const c of candidates) {
    if (freed >= shortfall || out.length >= 3) break;
    out.push({
      action: 'move',
      taskId: c.task.id,
      text: `Move "${c.task.title}" (${formatDuration(c.minutes)}) to after the deadline`,
      startAfter: dueAt + 1,
    });
    if (c.task.priority === 'low' && c.task.dueAt === undefined) {
      out.push({ action: 'drop', taskId: c.task.id, text: `Drop "${c.task.title}"` });
    }
    freed += c.minutes;
  }
  if (freed < shortfall) {
    out.push({
      action: 'extend',
      text: `Still ${formatDuration(shortfall - freed)} short: extend your working hours or shrink the estimate for "${task.title}"`,
    });
  }
  return out;
}

// ------------------------------------------------------------------ re-plan & helpers

/**
 * Re-packs the remaining day from `now` (or `now + lateMinutes`) and reports what changed.
 * Unfinished blocks in the past simply disappear; their work is planned again.
 */
export function replan(
  input: SchedulerInput,
  previous?: { blocks: Block[]; risks: Risk[] },
  lateMinutes = 0,
): ReplanResult {
  const plan = buildPlan({ ...input, notBefore: input.now + lateMinutes * MIN });

  const firstStart = (blocks: Block[]) => {
    const map = new Map<string, number>();
    for (const b of blocks) map.set(b.taskId, Math.min(map.get(b.taskId) ?? Infinity, b.start));
    return map;
  };
  const before = firstStart(previous?.blocks ?? input.tasks.flatMap((t) => t.blocks));
  const after = firstStart(plan.blocks);

  const moved = [...after]
    .filter(([id, start]) => before.has(id) && before.get(id) !== start)
    .map(([taskId, to]) => ({ taskId, from: before.get(taskId), to }));

  const knownRisks = new Set((previous?.risks ?? []).map((r) => `${r.taskId}:${r.kind}`));
  const newRisks = plan.risks.filter((r) => !knownRisks.has(`${r.taskId}:${r.kind}`));
  return { plan, moved, newRisks };
}

/** "Can I finish everything today?" */
export function dayFeasibility(input: SchedulerInput, plan: Plan): DayFeasibility {
  const { now, profile } = input;
  const eod = endOfDayTz(now, profile.timezone);
  const from = ceilToGrid(now);

  const due = input.tasks.filter(
    (t) => !t.deletedAt && ACTIVE.has(t.status) && t.fixedStart === undefined && t.dueAt !== undefined && t.dueAt <= eod,
  );
  const atRisk = due.filter((t) => {
    const placedToday = plan.blocks
      .filter((b) => b.taskId === t.id && b.end <= eod)
      .reduce((sum, b) => sum + (b.end - b.start) / MIN, 0);
    return placedToday + 1 < remainingMinutes(t, input.estimates);
  });

  const plannedMin = plan.blocks
    .filter((b) => b.start < eod)
    .reduce((sum, b) => sum + (b.end - b.start) / MIN, 0);

  let free = workWindows(profile, now, from, 1);
  for (const f of plan.fixed) if (!f.done) free = subtract(free, f);
  const availableMin = Math.round(free.reduce((sum, s) => sum + (s.end - s.start) / MIN, 0));

  return { canFinish: atRisk.length === 0, plannedMin: Math.round(plannedMin), availableMin, atRisk };
}

/** The block in progress, or the next one to start. */
export function nextBlock(plan: Pick<Plan, 'blocks'>, now: number): { block: Block; inProgress: boolean } | undefined {
  const upcoming = plan.blocks.filter((b) => b.end > now).sort((a, b) => a.start - b.start)[0];
  return upcoming && { block: upcoming, inProgress: upcoming.start <= now };
}
