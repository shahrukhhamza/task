// Reads clock times the way people say them. Used to double-check what an AI model
// returned: if the sentence says "9PM" the task must end at 21:00, whatever the model wrote.

const MERIDIEM = '(a\\.?m\\.?|p\\.?m\\.?)';
const TIME = `(\\d{1,2})(?::(\\d{2}))?\\s*${MERIDIEM}?`;
const RANGE = new RegExp(`(?<![\\w:.])${TIME}\\s*(?:to|until|till|through|thru|-|–|—)\\s*${TIME}(?![\\w:])`, 'gi');
const POINT = new RegExp(`(?<![\\w:.])(\\d{1,2})(?::(\\d{2}))?\\s*${MERIDIEM}(?![\\w])`, 'gi');

export interface SpokenTime {
  /** Minutes after midnight. */
  start: number;
  /** Set for ranges such as "8 AM to 9 PM". */
  end?: number;
}

const isPm = (m: string): boolean => m.toLowerCase().startsWith('p');

/** "8 in the morning" becomes "8 am", "9 at night" becomes "9 pm". */
export function normalizeDayParts(text: string): string {
  return text.replace(
    /(\d{1,2}(?::\d{2})?)\s*(?:o'?clock\s*)?(?:in the|at|of the|in)\s+(morning|afternoon|evening|night)\b/gi,
    (_all, time: string, part: string) => {
      const hour = parseInt(time, 10);
      const p = part.toLowerCase();
      // "12 at night" is midnight; "1 at night" is after midnight, "9 at night" is evening
      const pm = p === 'morning' ? false : p === 'night' ? hour >= 6 && hour !== 12 : true;
      return `${time} ${pm ? 'pm' : 'am'}`;
    },
  );
}

/** 12-hour clock plus am/pm to minutes after midnight, or undefined when it isn't a real time. */
function toMinutes(hour: number, minute: number, pm: boolean): number | undefined {
  if (hour < 1 || hour > 12 || minute > 59) return undefined;
  return ((hour % 12) + (pm ? 12 : 0)) * 60 + minute;
}

/** Explicit am/pm times and ranges in a sentence. Times without any am/pm are left to the parser. */
export function spokenTimes(raw: string): SpokenTime[] {
  const text = normalizeDayParts(raw);
  const found: SpokenTime[] = [];

  const rest = text.replace(RANGE, (all, h1: string, m1: string | undefined, a1: string | undefined, h2: string, m2: string | undefined, a2: string | undefined) => {
    if (!a1 && !a2) return all;
    const hour1 = parseInt(h1, 10);
    const hour2 = parseInt(h2, 10);
    const min1 = m1 ? parseInt(m1, 10) : 0;
    const min2 = m2 ? parseInt(m2, 10) : 0;

    let start: number | undefined;
    let end: number | undefined;
    if (a1 && a2) {
      start = toMinutes(hour1, min1, isPm(a1));
      end = toMinutes(hour2, min2, isPm(a2));
    } else if (a2) {
      // "8 to 9 pm": the start shares the end's am/pm unless that would run backwards ("11 to 1 pm")
      end = toMinutes(hour2, min2, isPm(a2));
      start = toMinutes(hour1, min1, isPm(a2));
      if (start !== undefined && end !== undefined && start >= end) start = toMinutes(hour1, min1, !isPm(a2));
    } else if (a1) {
      // "8 am to 9": the end shares the start's am/pm unless that would run backwards ("11 am to 1")
      start = toMinutes(hour1, min1, isPm(a1));
      end = toMinutes(hour2, min2, isPm(a1));
      if (start !== undefined && end !== undefined && end <= start) end = toMinutes(hour2, min2, !isPm(a1));
    }
    if (start === undefined || end === undefined) return all;
    found.push({ start, end });
    return ' '.repeat(all.length);
  });

  for (const m of rest.matchAll(POINT)) {
    const start = toMinutes(parseInt(m[1], 10), m[2] ? parseInt(m[2], 10) : 0, isPm(m[3]));
    if (start !== undefined) found.push({ start });
  }
  return found;
}
