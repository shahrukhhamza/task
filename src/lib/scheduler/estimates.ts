/** Learns how far off the user's estimates are, per category. */
export interface EstimateSample {
  category: string;
  estimateMin: number;
  actualMin: number;
}

export type EstimateStats = Record<string, { ratio: number; samples: number }>;

const MIN_SAMPLES = 3;
const MIN_RATIO = 0.5;
const MAX_RATIO = 2.5;

const DEFAULTS: Record<string, number> = {
  study: 90,
  work: 45,
  fitness: 60,
  health: 60,
  finance: 20,
  social: 90,
  home: 30,
  personal: 20,
};

export const defaultEstimateMin = (category: string | undefined): number => DEFAULTS[category ?? ''] ?? 30;

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

/** Median of actual/estimated per category; the median keeps one outlier from skewing it. */
export function buildEstimateStats(samples: EstimateSample[]): EstimateStats {
  const byCategory = new Map<string, number[]>();
  for (const s of samples) {
    if (s.estimateMin <= 0 || s.actualMin <= 0) continue;
    const list = byCategory.get(s.category) ?? [];
    list.push(s.actualMin / s.estimateMin);
    byCategory.set(s.category, list);
  }
  const stats: EstimateStats = {};
  for (const [category, ratios] of byCategory) {
    if (ratios.length < MIN_SAMPLES) continue;
    stats[category] = { ratio: Math.min(MAX_RATIO, Math.max(MIN_RATIO, median(ratios))), samples: ratios.length };
  }
  return stats;
}

/** Completed tasks with a measured duration are the learning signal. */
export function statsFromTasks(
  tasks: Array<{ status: string; deletedAt?: number | null; spentMin: number; category: string; estimateMin: number }>,
): EstimateStats {
  return buildEstimateStats(
    tasks
      .filter((t) => t.status === 'done' && !t.deletedAt && t.spentMin > 0)
      .map((t) => ({ category: t.category, estimateMin: t.estimateMin, actualMin: t.spentMin })),
  );
}

/** Scales an estimate by the learned ratio, rounded to 5 minutes. */
export function adjustEstimate(estimateMin: number, category: string, stats?: EstimateStats): number {
  const entry = stats?.[category];
  if (!entry) return estimateMin;
  return Math.max(5, Math.round((estimateMin * entry.ratio) / 5) * 5);
}
