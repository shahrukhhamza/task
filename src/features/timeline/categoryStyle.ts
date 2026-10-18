/** Full class names so Tailwind can see them. */
const PALETTE = [
  'bg-teal-100 border-teal-600 text-teal-950 dark:bg-teal-900/60 dark:border-teal-500 dark:text-teal-50',
  'bg-sky-100 border-sky-600 text-sky-950 dark:bg-sky-900/60 dark:border-sky-500 dark:text-sky-50',
  'bg-violet-100 border-violet-600 text-violet-950 dark:bg-violet-900/60 dark:border-violet-500 dark:text-violet-50',
  'bg-amber-100 border-amber-600 text-amber-950 dark:bg-amber-900/50 dark:border-amber-500 dark:text-amber-50',
  'bg-rose-100 border-rose-600 text-rose-950 dark:bg-rose-900/50 dark:border-rose-500 dark:text-rose-50',
  'bg-emerald-100 border-emerald-600 text-emerald-950 dark:bg-emerald-900/60 dark:border-emerald-500 dark:text-emerald-50',
  'bg-orange-100 border-orange-600 text-orange-950 dark:bg-orange-900/50 dark:border-orange-500 dark:text-orange-50',
  'bg-indigo-100 border-indigo-600 text-indigo-950 dark:bg-indigo-900/60 dark:border-indigo-500 dark:text-indigo-50',
  'bg-slate-200 border-slate-500 text-slate-900 dark:bg-slate-700 dark:border-slate-400 dark:text-slate-50',
];

const KNOWN: Record<string, number> = {
  personal: 0, work: 1, study: 2, finance: 3, health: 4, fitness: 5, social: 6, home: 7, general: 8,
};

export function categoryStyle(category: string): string {
  if (category in KNOWN) return PALETTE[KNOWN[category]];
  let hash = 0;
  for (const ch of category) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETTE[hash % 8];
}
