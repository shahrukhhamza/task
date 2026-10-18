import { TZDate } from '@date-fns/tz';
import type { Block, Task } from '../src/lib/types';

export const TZ = 'Asia/Karachi';

/** Local wall-clock time in the test zone as epoch ms. Month is 1-based. */
export const at = (month: number, day: number, hour = 0, minute = 0, tz = TZ): number =>
  new TZDate(2026, month - 1, day, hour, minute, 0, 0, tz).getTime();

/** Monday 19 Oct 2026, 10:00 in Karachi. */
export const NOW = at(10, 19, 10, 0);

export const CTX = { now: NOW, timezone: TZ };

let counter = 0;
export function makeTask(partial: Partial<Task> = {}): Task {
  counter += 1;
  return {
    id: partial.id ?? `t${counter}`,
    title: 'Task',
    category: 'general',
    priority: 'med',
    estimateMin: 60,
    spentMin: 0,
    status: 'todo',
    blocks: [],
    createdAt: NOW,
    updatedAt: NOW,
    syncState: 'local',
    ...partial,
  };
}

export const blocksOf = (blocks: Block[], taskId: string) =>
  blocks.filter((b) => b.taskId === taskId).sort((a, b) => a.start - b.start);
