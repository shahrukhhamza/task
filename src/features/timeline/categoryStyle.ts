/** Pastel card colour per category (full class names so Tailwind can see them). */
const PALETTE = [
  'bg-card-lime text-ink',
  'bg-card-sky text-ink',
  'bg-card-lilac text-ink',
  'bg-card-sun text-ink',
  'bg-card-coral text-ink',
  'bg-card-cream text-ink',
  'bg-card-mist text-ink',
];

const KNOWN: Record<string, number> = {
  personal: 0, fitness: 0, work: 1, study: 2, finance: 3, health: 4, social: 4, home: 5, general: 6,
};

export function categoryStyle(category: string): string {
  if (category in KNOWN) return PALETTE[KNOWN[category]];
  let hash = 0;
  for (const ch of category) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETTE[hash % PALETTE.length];
}
