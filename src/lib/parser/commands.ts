import { startOfDayTz } from '../time/tz';
import { parseDates } from './chronoTz';
import type { ParseContext, ParsedCommand } from './types';

const WORD_NUM = '(\\d+(?:\\.\\d+)?|an?|one|half an?|half)';
const UNIT = '(minutes?|mins?|hours?|hrs?|h|m)';

const quantityToMinutes = (qty: string, unit: string): number => {
  const q = qty.toLowerCase();
  const n = q.startsWith('half') ? 0.5 : /^an?$|^one$/.test(q) ? 1 : parseFloat(q);
  return Math.round(n * (/^h/i.test(unit) ? 60 : 1));
};

const clean = (target: string): string =>
  target
    .replace(/\b(?:task|please|now|today|for now|already)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const PREFIX = "(?:i(?:'ve|'m|\\s+have|\\s+am|\\s+will|'ll)?\\s+|just\\s+|let'?s\\s+|now\\s+)*";

/**
 * Returns a command when the sentence is addressed at existing tasks.
 * Anything that doesn't match falls through to normal task parsing.
 */
export function parseCommand(input: string, ctx: ParseContext): ParsedCommand | null {
  const text = input.trim().replace(/[.!]+$/, '').replace(/\s+/g, ' ');
  if (!text || text.includes('\n')) return null;
  const lower = text.toLowerCase();
  let m: RegExpExecArray | null;

  // "what's next?"
  if (/^(?:so,?\s+)?(?:what(?:'s|\s+is)?\s+(?:next|now|up next)|what\s+(?:should|do)\s+i\s+do(?:\s+(?:next|now))?|what\s+next|next\s+task|up\s+next)\s*\??$/.test(lower)) {
    return { kind: 'next' };
  }

  // "I'm running 30 minutes late" / "an hour behind"
  m = new RegExp(`^(?:i(?:'m|\\s+am)\\s+|we(?:'re|\\s+are)\\s+|running\\s+|am\\s+)*(?:about\\s+|around\\s+)?${WORD_NUM}\\s*${UNIT}\\s+(?:late|behind)(?:\\s+schedule)?$`).exec(lower);
  if (m) return { kind: 'late', minutes: quantityToMinutes(m[1], m[2]) };

  if (/^(?:i(?:'m|\s+am)\s+|i\s+fell\s+|we(?:'re|\s+are)\s+|running\s+)*(?:a\s+bit\s+|a\s+little\s+|really\s+|so\s+|very\s+)?(?:late|behind|behind\s+schedule)$/.test(lower)
    || /^(?:please\s+)?re-?plan(?:\s+my\s+day)?(?:\s+from\s+now)?$/.test(lower)
    || /^i\s+fell\s+behind$/.test(lower)) {
    return { kind: 'late' };
  }

  // "push gym to tomorrow", "move dentist to 5pm"
  m = /^(?:please\s+|can you\s+)?(?:push|postpone|move|reschedule|shift|delay|defer)\s+(?:back\s+)?(?:the\s+|my\s+)?(.+?)\s+(?:to|until|till|for|onto)\s+(.+)$/.exec(lower);
  if (m) {
    const parsed = parseDates(m[2], ctx)[0];
    if (parsed) {
      const { hasTime, start } = parsed;
      return { kind: 'push', target: clean(m[1]), to: hasTime ? start : startOfDayTz(start, ctx.timezone), hasTime };
    }
  }

  // "I finished the assignment", "done with gym", "mark gym as done", "gym is done"
  m = new RegExp(`^${PREFIX}(?:finished|completed|done\\s+with|finished\\s+with|done|did|wrapped\\s+up|nailed|knocked\\s+out)\\s+(?:with\\s+)?(?:the\\s+|my\\s+|that\\s+)?(.+)$`).exec(lower);
  if (m) return { kind: 'finish', target: clean(m[1]) };
  m = /^(?:mark|tick\s+off|check\s+off|cross\s+off)\s+(?:the\s+|my\s+)?(.+?)(?:\s+(?:as\s+)?(?:done|complete|completed|finished))?$/.exec(lower);
  if (m) return { kind: 'finish', target: clean(m[1]) };
  m = /^(?:the\s+|my\s+)?(.+?)\s+(?:is|are)\s+(?:done|finished|complete|completed)$/.exec(lower);
  if (m) return { kind: 'finish', target: clean(m[1]) };

  // "start the assignment", "I'm starting gym", "let's work on the report"
  m = new RegExp(`^${PREFIX}(?:start|starting|begin|beginning)\\s+(?:on\\s+|with\\s+)?(?:the\\s+|my\\s+)?(.+)$`).exec(lower);
  if (m) return { kind: 'start', target: clean(m[1]) };
  m = new RegExp(`^(?:i(?:'m|\\s+am)\\s+|let'?s\\s+|lets\\s+|now\\s+)+(?:work\\s+on|working\\s+on)\\s+(?:the\\s+|my\\s+)?(.+)$`).exec(lower);
  if (m) return { kind: 'start', target: clean(m[1]) };

  // "delete call mom"
  m = /^(?:please\s+)?(?:delete|remove|cancel|drop|scrap|trash|get\s+rid\s+of|forget\s+about)\s+(?:the\s+|my\s+)?(.+)$/.exec(lower);
  if (m) return { kind: 'delete', target: clean(m[1]) };

  return null;
}
