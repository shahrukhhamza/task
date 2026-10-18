import type { Block, FixedEvent, Profile, Task } from '../types';
import type { EstimateStats } from './estimates';

export type PlannerConfig = Pick<
  Profile,
  'timezone' | 'workStart' | 'workEnd' | 'peakStart' | 'peakEnd' | 'maxChunkMin' | 'maxFocusMin' | 'breakMin' | 'bufferMin'
>;

export interface SchedulerInput {
  tasks: Task[];
  fixedEvents: FixedEvent[];
  profile: PlannerConfig;
  now: number;
  /** How many days ahead to plan, counting today. Defaults to 7. */
  horizonDays?: number;
  /** Nothing is planned before this moment (used for "I'm running 30 minutes late"). */
  notBefore?: number;
  /** Per-category history used to correct optimistic estimates. */
  estimates?: EstimateStats;
}

export interface Interval {
  start: number;
  end: number;
}

/** A commitment the planner must never overlap. */
export interface FixedItem extends Interval {
  id: string;
  title: string;
  source: 'task' | 'event';
  taskId?: string;
  done?: boolean;
}

export interface Suggestion {
  action: 'move' | 'drop' | 'extend';
  taskId?: string;
  text: string;
  /** For `move`: the earliest moment the task may start afterwards. */
  startAfter?: number;
}

export interface Risk {
  taskId: string;
  kind: 'overdue' | 'miss';
  message: string;
  shortfallMin: number;
  suggestions: Suggestion[];
}

export interface Plan {
  blocks: Block[];
  fixed: FixedItem[];
  risks: Risk[];
  /** Minutes that could not be placed, per task. */
  unscheduled: Record<string, number>;
  generatedAt: number;
}

export interface ReplanChange {
  taskId: string;
  from?: number;
  to?: number;
}

export interface ReplanResult {
  plan: Plan;
  /** Tasks whose first block changed. */
  moved: ReplanChange[];
  /** Risks that were not present before this re-plan. */
  newRisks: Risk[];
}

export interface DayFeasibility {
  canFinish: boolean;
  plannedMin: number;
  availableMin: number;
  /** Tasks due today that the planner cannot fit before the end of the day. */
  atRisk: Task[];
}
