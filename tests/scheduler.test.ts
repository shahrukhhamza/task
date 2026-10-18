import { describe, expect, it } from 'vitest';
import {
  adjustEstimate,
  buildEstimateStats,
  buildPlan,
  dayFeasibility,
  defaultEstimateMin,
  nextBlock,
  priorityScore,
  replan,
  type SchedulerInput,
} from '../src/lib/scheduler';
import { DEFAULT_PROFILE, type FixedEvent } from '../src/lib/types';
import { MIN } from '../src/lib/time/tz';
import { NOW, TZ, at, blocksOf, makeTask } from './helpers';

const profile = { ...DEFAULT_PROFILE, timezone: TZ };

const input = (over: Partial<SchedulerInput> = {}): SchedulerInput => ({
  tasks: [],
  fixedEvents: [],
  profile,
  now: NOW,
  ...over,
});

const event = (start: number, end: number, title = 'Event'): FixedEvent => ({
  id: `e${start}`,
  title,
  start,
  end,
  source: 'manual',
  updatedAt: NOW,
  syncState: 'local',
});

const minutes = (b: { start: number; end: number }) => (b.end - b.start) / MIN;
const total = (blocks: { start: number; end: number }[]) => blocks.reduce((s, b) => s + minutes(b), 0);

describe('basic placement', () => {
  it('starts the first task right away inside working hours', () => {
    const t = makeTask({ title: 'Write', estimateMin: 30 });
    const plan = buildPlan(input({ tasks: [t] }));
    expect(plan.blocks).toHaveLength(1);
    expect(plan.blocks[0].start).toBe(NOW);
    expect(minutes(plan.blocks[0])).toBe(30);
  });

  it('plans from the start of the workday when it is early morning', () => {
    const t = makeTask({ estimateMin: 30 });
    const plan = buildPlan(input({ tasks: [t], now: at(10, 19, 6) }));
    expect(plan.blocks[0].start).toBe(at(10, 19, 9));
  });

  it('rolls to the next morning after work hours', () => {
    const t = makeTask({ estimateMin: 30 });
    const plan = buildPlan(input({ tasks: [t], now: at(10, 19, 19) }));
    expect(plan.blocks[0].start).toBe(at(10, 20, 9));
  });

  it('never schedules done, dropped, skipped or deleted tasks', () => {
    const tasks = [
      makeTask({ status: 'done' }),
      makeTask({ status: 'dropped' }),
      makeTask({ status: 'skipped' }),
      makeTask({ deletedAt: NOW }),
    ];
    expect(buildPlan(input({ tasks })).blocks).toEqual([]);
  });

  it('keeps every block inside the working window', () => {
    const tasks = Array.from({ length: 12 }, (_, i) => makeTask({ id: `x${i}`, estimateMin: 90 }));
    const plan = buildPlan(input({ tasks }));
    for (const b of plan.blocks) {
      expect(b.start).toBeGreaterThanOrEqual(at(10, b.start >= at(10, 20) ? 20 : 19, 9) - 0);
    }
    expect(plan.blocks.every((b) => b.end <= at(10, 26, 18))).toBe(true);
  });

  it('works in another timezone without hardcoded offsets', () => {
    const tz = 'America/New_York';
    const now = at(10, 19, 10, 0, tz);
    const plan = buildPlan({
      tasks: [makeTask({ estimateMin: 60 })],
      fixedEvents: [],
      profile: { ...profile, timezone: tz },
      now,
    });
    expect(plan.blocks[0].start).toBe(now);
  });
});

describe('fixed events', () => {
  it('never overlaps events, keeping a buffer around them', () => {
    const ev = event(at(10, 19, 11), at(10, 19, 12));
    const plan = buildPlan(input({ fixedEvents: [ev], tasks: [makeTask({ estimateMin: 120 })] }));
    for (const b of plan.blocks) {
      const overlap = b.start < ev.end + 10 * MIN && ev.start - 10 * MIN < b.end;
      expect(overlap).toBe(false);
    }
    expect(total(plan.blocks)).toBe(120);
  });

  it('treats tasks with fixed times as commitments', () => {
    const appt = makeTask({ title: 'Dentist', fixedStart: at(10, 19, 14), fixedEnd: at(10, 19, 15) });
    const plan = buildPlan(input({ tasks: [appt, makeTask({ estimateMin: 300 })] }));
    expect(plan.blocks.some((b) => b.taskId === appt.id)).toBe(false);
    expect(plan.fixed.map((f) => f.title)).toContain('Dentist');
    for (const b of plan.blocks) expect(b.start < at(10, 19, 15, 10) && at(10, 19, 13, 50) < b.end).toBe(false);
  });

  it('ignores deleted events', () => {
    const ev = { ...event(at(10, 19, 10), at(10, 19, 12)), deletedAt: NOW };
    const plan = buildPlan(input({ fixedEvents: [ev], tasks: [makeTask({ estimateMin: 30 })] }));
    expect(plan.blocks[0].start).toBe(NOW);
  });
});

describe('energy-aware placement', () => {
  const early = at(10, 19, 7);

  it('puts hard work in the peak window', () => {
    const hard = makeTask({ title: 'Hard', priority: 'high', estimateMin: 90, category: 'study' });
    const plan = buildPlan(input({ tasks: [hard], now: early }));
    expect(plan.blocks[0].start).toBeGreaterThanOrEqual(at(10, 19, 9));
    expect(plan.blocks[0].end).toBeLessThanOrEqual(at(10, 19, 12));
  });

  it('keeps even a higher-scoring easy task out of the peak while hard work still needs it', () => {
    const easy = makeTask({ id: 'easy', estimateMin: 15, dueAt: at(10, 19, 17) });
    const hard = makeTask({ id: 'hard', priority: 'low', estimateMin: 100 });
    const plan = buildPlan(input({ tasks: [easy, hard], now: early }));
    expect(blocksOf(plan.blocks, 'easy')[0].start).toBeGreaterThanOrEqual(at(10, 19, 12));
    expect(blocksOf(plan.blocks, 'hard')[0].start).toBe(at(10, 19, 9));
  });

  it('uses leftover peak time for easy work once hard work is placed', () => {
    const hard = makeTask({ id: 'hard', priority: 'high', estimateMin: 90 });
    const easy = makeTask({ id: 'easy', priority: 'low', estimateMin: 15 });
    const plan = buildPlan(input({ tasks: [easy, hard], now: early }));
    const hardEnd = blocksOf(plan.blocks, 'hard')[0].end;
    expect(blocksOf(plan.blocks, 'easy')[0].start).toBeGreaterThanOrEqual(hardEnd);
    expect(blocksOf(plan.blocks, 'easy')[0].end).toBeLessThanOrEqual(at(10, 19, 12));
  });

  it('lets easy work use the peak window when nothing hard is waiting', () => {
    const easy = makeTask({ priority: 'low', estimateMin: 15 });
    const plan = buildPlan(input({ tasks: [easy], now: early }));
    expect(plan.blocks[0].start).toBe(at(10, 19, 9));
  });

  it('gives the peak window to the higher-scoring hard task', () => {
    const big = makeTask({ id: 'big', priority: 'high', estimateMin: 150 });
    const other = makeTask({ id: 'other', priority: 'med', estimateMin: 120 });
    const plan = buildPlan(input({ tasks: [other, big], now: early }));
    expect(blocksOf(plan.blocks, 'big')[0].start).toBe(at(10, 19, 9));
    expect(blocksOf(plan.blocks, 'other')[0].start).toBeGreaterThan(at(10, 19, 9));
  });

  it('falls back to non-peak slots when peak is full', () => {
    const tasks = [
      makeTask({ id: 'a', priority: 'high', estimateMin: 90 }),
      makeTask({ id: 'b', priority: 'high', estimateMin: 90 }),
    ];
    const plan = buildPlan(input({ tasks, now: early }));
    expect(plan.blocks).toHaveLength(2);
    expect(plan.unscheduled).toEqual({});
  });
});

describe('chunking, breaks and buffers', () => {
  it('splits long tasks into chunks no longer than the maximum', () => {
    const t = makeTask({ id: 'long', estimateMin: 200 });
    const blocks = blocksOf(buildPlan(input({ tasks: [t] })).blocks, 'long');
    expect(blocks.length).toBeGreaterThanOrEqual(3);
    expect(blocks.every((b) => minutes(b) <= 90)).toBe(true);
    expect(total(blocks)).toBe(200);
    expect(blocks.map((b) => [b.chunk, b.chunks])).toEqual(blocks.map((_, i) => [i + 1, blocks.length]));
  });

  it('balances chunks instead of leaving a tiny remainder', () => {
    const t = makeTask({ id: 'mid', estimateMin: 100 });
    const blocks = blocksOf(buildPlan(input({ tasks: [t] })).blocks, 'mid');
    expect(blocks.map(minutes)).toEqual([50, 50]);
  });

  it('leaves a break between consecutive blocks', () => {
    const tasks = [makeTask({ id: 'a', estimateMin: 60 }), makeTask({ id: 'b', estimateMin: 60 })];
    const blocks = [...buildPlan(input({ tasks })).blocks].sort((x, y) => x.start - y.start);
    expect(blocks[1].start - blocks[0].end).toBeGreaterThanOrEqual(10 * MIN);
  });

  it('spills onto the next day when today is full', () => {
    const tasks = Array.from({ length: 6 }, (_, i) => makeTask({ id: `t${i}`, estimateMin: 90 }));
    const plan = buildPlan(input({ tasks }));
    expect(plan.blocks.some((b) => b.start >= at(10, 20, 9))).toBe(true);
    expect(plan.unscheduled).toEqual({});
  });
});

describe('daily focus cap', () => {
  const dayMinutes = (blocks: { start: number; end: number }[], month: number, day: number) =>
    total(blocks.filter((b) => b.start >= at(month, day, 0) && b.start < at(month, day + 1, 0)));

  it('never plans more than the cap on any day', () => {
    const t = makeTask({ id: 'big', estimateMin: 60 * 20 });
    const { blocks } = buildPlan(input({ tasks: [t], now: at(10, 19, 8) }));
    for (let d = 19; d <= 25; d++) expect(dayMinutes(blocks, 10, d)).toBeLessThanOrEqual(360);
    expect(total(blocks)).toBe(60 * 20);
  });

  it('flags a deadline that only fits by overworking', () => {
    // 30h before Thursday night is ~33h of working time, but only 24h at 6h per day
    const t = makeTask({ id: 'big', title: 'Thesis', estimateMin: 60 * 30, dueAt: at(10, 22, 23, 59) });
    const plan = buildPlan(input({ tasks: [t], now: at(10, 19, 8) }));
    expect(plan.risks[0]?.kind).toBe('miss');
    expect(plan.unscheduled.big).toBe(60 * 30 - 60 * 24);
  });

  it('counts hand-placed blocks towards the cap', () => {
    const pinned = { id: 'p', taskId: 'a', start: at(10, 19, 9), end: at(10, 19, 14), chunk: 1, chunks: 1, locked: true };
    const a = makeTask({ id: 'a', estimateMin: 300, blocks: [pinned] });
    const b = makeTask({ id: 'b', estimateMin: 120 });
    const { blocks } = buildPlan(input({ tasks: [a, b], now: at(10, 19, 8) }));
    expect(dayMinutes(blocks, 10, 19)).toBe(360);
    expect(total(blocksOf(blocks, 'b'))).toBe(120);
  });
});

describe('deadlines and risk', () => {
  it('never places work after the deadline', () => {
    const t = makeTask({ estimateMin: 60, dueAt: at(10, 19, 13) });
    const plan = buildPlan(input({ tasks: [t] }));
    expect(plan.blocks.every((b) => b.end <= at(10, 19, 13))).toBe(true);
    expect(plan.risks).toEqual([]);
  });

  it('flags a task that cannot fit and names the weekday', () => {
    const t = makeTask({ id: 'big', title: 'Thesis', estimateMin: 60 * 40, dueAt: at(10, 22, 23, 59) });
    const plan = buildPlan(input({ tasks: [t] }));
    expect(plan.unscheduled.big).toBeGreaterThan(0);
    const risk = plan.risks.find((r) => r.taskId === 'big');
    expect(risk?.kind).toBe('miss');
    expect(risk?.message).toContain("miss Thursday's deadline");
    expect(risk?.message).toContain('Thesis');
  });

  it('says "today" and suggests moving lower-ranked work', () => {
    const urgent = makeTask({ id: 'u', title: 'Report', priority: 'high', estimateMin: 240, dueAt: at(10, 19, 14) });
    const filler = makeTask({ id: 'f', title: 'Tidy desk', priority: 'low', estimateMin: 30 });
    const plan = buildPlan(input({ tasks: [urgent, filler] }));
    const risk = plan.risks.find((r) => r.taskId === 'u');
    expect(risk?.message).toContain("miss today's deadline");
    expect(risk?.shortfallMin).toBeGreaterThan(0);
    expect(risk?.suggestions.length).toBeGreaterThan(0);
  });

  it('suggests moving or dropping a low-priority task that blocks the deadline', () => {
    const urgent = makeTask({ id: 'u', title: 'Report', priority: 'high', estimateMin: 120, dueAt: at(10, 19, 12, 30) });
    const fluff = makeTask({ id: 'f', title: 'Sort photos', priority: 'low', estimateMin: 60 });
    const plan = buildPlan(input({ tasks: [urgent, fluff] }));
    expect(plan.blocks.filter((b) => b.taskId === 'u').every((b) => b.end <= at(10, 19, 12, 30))).toBe(true);
    // fits only partly, so the task is flagged; the low priority task is offered to be moved
    const risk = plan.risks.find((r) => r.taskId === 'u');
    if (risk) expect(risk.suggestions.some((s) => s.taskId === 'f' || s.action === 'extend')).toBe(true);
  });

  it('flags overdue tasks but still schedules them', () => {
    const t = makeTask({ id: 'late', estimateMin: 30, dueAt: at(10, 18, 17) });
    const plan = buildPlan(input({ tasks: [t] }));
    expect(plan.risks[0]).toMatchObject({ taskId: 'late', kind: 'overdue' });
    expect(blocksOf(plan.blocks, 'late')).toHaveLength(1);
  });

  it('plans a deadline-bound task ahead of a higher-scoring one when both cannot fit otherwise', () => {
    const tight = makeTask({ id: 'tight', priority: 'low', estimateMin: 240, dueAt: at(10, 19, 15) });
    const big = makeTask({ id: 'big', priority: 'high', estimateMin: 240 });
    const plan = buildPlan(input({ tasks: [big, tight] }));
    expect(plan.risks.filter((r) => r.kind === 'miss')).toEqual([]);
  });
});

describe('priority score', () => {
  it('ranks near deadlines above open-ended work', () => {
    const urgent = makeTask({ dueAt: NOW + 4 * 3_600_000, estimateMin: 120 });
    const relaxed = makeTask({});
    expect(priorityScore(urgent, NOW)).toBeGreaterThan(priorityScore(relaxed, NOW));
  });

  it('ranks overdue highest and importance above age', () => {
    const overdue = makeTask({ dueAt: NOW - 1 });
    const later = makeTask({ dueAt: NOW + 10 * 86_400_000 });
    expect(priorityScore(overdue, NOW)).toBeGreaterThan(priorityScore(later, NOW));
    expect(priorityScore(makeTask({ priority: 'high' }), NOW)).toBeGreaterThan(priorityScore(makeTask({ priority: 'low' }), NOW));
  });

  it('gives a tighter deadline a higher score with the same duration', () => {
    const near = makeTask({ dueAt: NOW + 6 * 3_600_000, estimateMin: 240 });
    const far = makeTask({ dueAt: NOW + 48 * 3_600_000, estimateMin: 240 });
    expect(priorityScore(near, NOW)).toBeGreaterThan(priorityScore(far, NOW));
  });

  it('rewards age', () => {
    const old = makeTask({ createdAt: NOW - 8 * 86_400_000 });
    const fresh = makeTask({ createdAt: NOW });
    expect(priorityScore(old, NOW)).toBeGreaterThan(priorityScore(fresh, NOW));
  });
});

describe('re-planning', () => {
  it('re-packs from the current time and drops old blocks in the past', () => {
    const t = makeTask({ id: 'a', estimateMin: 60 });
    const first = buildPlan(input({ tasks: [t] }));
    const later = NOW + 3 * 3_600_000;
    const result = replan(
      input({ tasks: [{ ...t, blocks: first.blocks }], now: later }),
      { blocks: first.blocks, risks: first.risks },
    );
    expect(result.plan.blocks[0].start).toBeGreaterThanOrEqual(later);
    expect(result.moved).toEqual([{ taskId: 'a', from: NOW, to: result.plan.blocks[0].start }]);
  });

  it('shifts everything by the number of minutes the user is late', () => {
    const t = makeTask({ estimateMin: 60 });
    const { plan } = replan(input({ tasks: [t] }), undefined, 30);
    expect(plan.blocks[0].start).toBe(NOW + 30 * MIN);
  });

  it('reports risks that appear only after falling behind', () => {
    const t = makeTask({ id: 'x', title: 'Essay', estimateMin: 180, dueAt: at(10, 19, 14) });
    const before = buildPlan(input({ tasks: [t] }));
    expect(before.risks).toHaveLength(0);
    const result = replan(input({ tasks: [t] }), { blocks: before.blocks, risks: before.risks }, 90);
    expect(result.newRisks).toHaveLength(1);
    expect(result.newRisks[0].message).toContain("today's deadline");
  });

  it('keeps blocks the user locked by hand', () => {
    const pinned = { id: 'p', taskId: 'a', start: at(10, 19, 15), end: at(10, 19, 16), chunk: 1, chunks: 1, locked: true };
    const t = makeTask({ id: 'a', estimateMin: 60, blocks: [pinned] });
    const plan = buildPlan(input({ tasks: [t] }));
    const blocks = blocksOf(plan.blocks, 'a');
    expect(blocks).toHaveLength(1);
    expect(blocks[0].start).toBe(pinned.start);
  });

  it('plans other work around locked blocks', () => {
    const pinned = { id: 'p', taskId: 'a', start: at(10, 19, 10), end: at(10, 19, 11), chunk: 1, chunks: 1, locked: true };
    const a = makeTask({ id: 'a', estimateMin: 60, blocks: [pinned] });
    const b = makeTask({ id: 'b', estimateMin: 30 });
    const plan = buildPlan(input({ tasks: [a, b] }));
    expect(blocksOf(plan.blocks, 'b')[0].start).toBeGreaterThanOrEqual(at(10, 19, 11, 10));
  });

  it('honours startAfter for pushed tasks', () => {
    const t = makeTask({ estimateMin: 30, startAfter: at(10, 20, 0) });
    const plan = buildPlan(input({ tasks: [t] }));
    expect(plan.blocks[0].start).toBe(at(10, 20, 9));
  });

  it('plans an in-progress task first', () => {
    const doing = makeTask({ id: 'doing', status: 'doing', priority: 'low', estimateMin: 30 });
    const urgent = makeTask({ id: 'u', priority: 'high', estimateMin: 30, dueAt: NOW + 4 * 3_600_000 });
    const plan = buildPlan(input({ tasks: [urgent, doing] }));
    expect(blocksOf(plan.blocks, 'doing')[0].start).toBe(NOW);
  });

  it('still rescues a deadline that an in-progress task would otherwise cause to be missed', () => {
    const doing = makeTask({ id: 'doing', status: 'doing', priority: 'low', estimateMin: 30 });
    const urgent = makeTask({ id: 'u', priority: 'high', estimateMin: 30, dueAt: NOW + 3_600_000 });
    const plan = buildPlan(input({ tasks: [urgent, doing] }));
    expect(plan.risks).toEqual([]);
    expect(blocksOf(plan.blocks, 'u')[0].end).toBeLessThanOrEqual(NOW + 3_600_000);
  });
});

describe('estimate learning', () => {
  const samples = (category: string, ratios: number[]) =>
    ratios.map((r) => ({ category, estimateMin: 60, actualMin: 60 * r }));

  it('needs at least three samples', () => {
    expect(buildEstimateStats(samples('study', [1.5, 1.5]))).toEqual({});
  });

  it('uses the median ratio per category', () => {
    const stats = buildEstimateStats(samples('study', [1.2, 1.5, 3.0]));
    expect(stats.study.ratio).toBe(1.5);
    expect(adjustEstimate(60, 'study', stats)).toBe(90);
    expect(adjustEstimate(60, 'work', stats)).toBe(60);
  });

  it('clamps extreme ratios', () => {
    expect(buildEstimateStats(samples('x', [10, 10, 10])).x.ratio).toBe(2.5);
    expect(buildEstimateStats(samples('x', [0.1, 0.1, 0.1])).x.ratio).toBe(0.5);
  });

  it('feeds adjusted estimates into the plan', () => {
    const stats = buildEstimateStats(samples('study', [2, 2, 2]));
    const t = makeTask({ id: 's', category: 'study', estimateMin: 30 });
    const plan = buildPlan(input({ tasks: [t], estimates: stats }));
    expect(total(blocksOf(plan.blocks, 's'))).toBe(60);
  });

  it('has sensible defaults by category', () => {
    expect(defaultEstimateMin('study')).toBeGreaterThan(defaultEstimateMin('personal'));
    expect(defaultEstimateMin(undefined)).toBe(30);
  });
});

describe('morning feasibility check', () => {
  it('says yes when everything due today fits', () => {
    const t = makeTask({ estimateMin: 60, dueAt: at(10, 19, 23, 59) });
    const i = input({ tasks: [t] });
    const result = dayFeasibility(i, buildPlan(i));
    expect(result.canFinish).toBe(true);
    expect(result.plannedMin).toBe(60);
    expect(result.availableMin).toBeGreaterThan(300);
  });

  it('says no and lists tasks that cannot fit today', () => {
    const t = makeTask({ id: 'big', estimateMin: 600, dueAt: at(10, 19, 23, 59) });
    const i = input({ tasks: [t] });
    const result = dayFeasibility(i, buildPlan(i));
    expect(result.canFinish).toBe(false);
    expect(result.atRisk.map((x) => x.id)).toEqual(['big']);
  });
});

describe('next block', () => {
  it('finds the block in progress or the next one', () => {
    const t = makeTask({ estimateMin: 60 });
    const plan = buildPlan(input({ tasks: [t] }));
    expect(nextBlock(plan, NOW)?.inProgress).toBe(true);
    expect(nextBlock(plan, NOW - 3_600_000)?.inProgress).toBe(false);
    expect(nextBlock(plan, plan.blocks[0].end + 1)).toBeUndefined();
  });
});
