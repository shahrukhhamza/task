import Fuse from 'fuse.js';
import type { Task } from '../types';

export type Resolution =
  | { kind: 'match'; task: Task }
  | { kind: 'ambiguous'; candidates: Task[] }
  | { kind: 'none' };

const MAX_SCORE = 0.4;
/** Tasks scoring this close to the best one are treated as equally likely. */
const TIE_MARGIN = 0.1;

const STOP_WORDS = new Set(['the', 'my', 'a', 'an', 'to', 'of', 'for', 'on', 'with', 'task', 'session']);

function search(fuse: Fuse<Task>, query: string) {
  const full = fuse.search(query);
  if (full.length) return full;

  // fall back to the best single word, so "gym session" still finds "Gym"
  const tokens = query.split(/\s+/).filter((t) => t.length > 2 && !STOP_WORDS.has(t));
  const best = new Map<string, { item: Task; score: number }>();
  for (const token of tokens) {
    for (const r of fuse.search(token)) {
      const score = r.score ?? 1;
      const prev = best.get(r.item.id);
      if (!prev || score < prev.score) best.set(r.item.id, { item: r.item, score });
    }
  }
  return [...best.values()].map((r) => ({ item: r.item, score: r.score + 0.05 }));
}

/** Finds which existing task a spoken or typed reference points to. */
export function resolveTarget(query: string, tasks: Task[]): Resolution {
  const q = query.trim().toLowerCase();
  if (!q || tasks.length === 0) return { kind: 'none' };

  const fuse = new Fuse(tasks, {
    keys: [{ name: 'title', weight: 1 }, { name: 'category', weight: 0.2 }],
    includeScore: true,
    threshold: MAX_SCORE,
    ignoreLocation: true,
  });

  const results = search(fuse, q)
    .filter((r) => (r.score ?? 1) <= MAX_SCORE)
    .sort((a, b) => (a.score ?? 1) - (b.score ?? 1));
  if (results.length === 0) return { kind: 'none' };

  const best = results[0].score ?? 1;
  const close = results.filter((r) => (r.score ?? 1) - best <= TIE_MARGIN);
  if (close.length === 1) return { kind: 'match', task: close[0].item };
  return { kind: 'ambiguous', candidates: close.slice(0, 4).map((r) => r.item) };
}
