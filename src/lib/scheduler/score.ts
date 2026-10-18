import { DAY, HOUR } from '../time/tz';
import type { Priority, Task } from '../types';
import { adjustEstimate, type EstimateStats } from './estimates';

const IMPORTANCE: Record<Priority, number> = { high: 1, med: 0.6, low: 0.3 };

/** How many minutes of work are still left on a task, after learned adjustment and focus already spent. */
export function remainingMinutes(task: Task, stats?: EstimateStats): number {
  const total = adjustEstimate(task.estimateMin, task.category, stats);
  return Math.max(10, total - task.spentMin);
}

/**
 * 0..1.5. Compares the time left to the deadline against the work still to do:
 * the less slack, the higher the urgency. Overdue tasks score above 1.
 */
export function urgency(task: Task, now: number, stats?: EstimateStats): number {
  if (task.dueAt === undefined) return 0.15;
  if (task.dueAt < now) return 1.25;
  const slackHours = (task.dueAt - now) / HOUR - remainingMinutes(task, stats) / 60;
  if (slackHours <= 0) return 1;
  return Math.min(1, Math.max(0.1, 1 - slackHours / 72));
}

/** Higher scores are planned first and get the best slots. */
export function priorityScore(task: Task, now: number, stats?: EstimateStats): number {
  const age = Math.min(1, Math.max(0, (now - task.createdAt) / (7 * DAY)));
  return 0.5 * urgency(task, now, stats) + 0.35 * IMPORTANCE[task.priority] + 0.15 * age;
}

export type Effort = 'hard' | 'medium' | 'easy';

/** Hard work goes to the peak-energy window, easy work to the low-energy hours. */
export function effortOf(task: Task, minutes: number): Effort {
  if (minutes >= 90 || (task.priority === 'high' && minutes >= 45) || (task.category === 'study' && minutes >= 45)) return 'hard';
  if (minutes <= 30 && task.priority !== 'high') return 'easy';
  return 'medium';
}
