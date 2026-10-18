import type { FixedItem } from '../../lib/scheduler';
import type { Block, Task } from '../../lib/types';

export interface DayItem {
  key: string;
  start: number;
  end: number;
  title: string;
  kind: 'block' | 'appointment' | 'event';
  task?: Task;
  block?: Block;
}

const ACTIVE = new Set(['todo', 'scheduled', 'doing']);

/** Everything happening in [start, end): planned blocks, appointments and calendar events, in time order. */
export function dayItems(tasks: Task[], fixed: FixedItem[], start: number, end: number): DayItem[] {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const items: DayItem[] = [];
  for (const task of tasks) {
    if (!ACTIVE.has(task.status)) continue;
    for (const block of task.blocks) {
      if (block.start < end && block.end > start) items.push({ key: block.id, start: block.start, end: block.end, title: task.title, kind: 'block', task, block });
    }
  }
  for (const f of fixed) {
    if (f.done || f.start >= end || f.end <= start) continue;
    const task = f.taskId ? byId.get(f.taskId) : undefined;
    items.push({ key: f.id, start: f.start, end: f.end, title: f.title, kind: f.source === 'event' ? 'event' : 'appointment', task });
  }
  return items.sort((a, b) => a.start - b.start);
}
