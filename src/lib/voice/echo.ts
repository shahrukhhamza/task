// The microphone stays open while the assistant talks (restarting it after every answer costs
// half a second or more). That means it can hear its own voice, or hear the same sentence twice
// (an early guess and then the browser's final version). These checks drop both.

const normalize = (text: string): string[] =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9À-ɏ\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

/** Share of `heard`'s words that also appear in `reference`, 0 to 1. */
export function overlap(heard: string, reference: string): number {
  const words = normalize(heard);
  if (!words.length) return 0;
  const known = new Set(normalize(reference));
  return words.filter((w) => known.has(w)).length / words.length;
}

interface Entry {
  text: string;
  at: number;
}

/**
 * True when `heard` is the assistant's own answer coming back through the speaker, or the
 * sentence that was handled a moment ago arriving again in its final form.
 * Saying "undo" twice in a row is neither: short phrases are only ever compared with what was handled
 * in the last couple of seconds.
 */
export function isEcho(heard: string, recent: { spoken?: Entry; handled?: Entry }, now: number): boolean {
  const words = normalize(heard);
  if (!words.length) return true;

  const { spoken, handled } = recent;
  if (spoken && now - spoken.at < 15_000 && words.length >= 3 && overlap(heard, spoken.text) >= 0.7) return true;
  if (handled && now - handled.at < 2500 && overlap(heard, handled.text) >= 0.8 && overlap(handled.text, heard) >= 0.6) return true;
  return false;
}
