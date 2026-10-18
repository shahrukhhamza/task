import type { Priority, Recurrence } from '../types';

/** Every extractor returns the value plus the text with the matched phrase blanked out. */
export interface Extraction<T> {
  value: T | undefined;
  text: string;
}

const blank = (text: string, m: RegExpExecArray): string =>
  text.slice(0, m.index) + ' ' + text.slice(m.index + m[0].length);

const NUMBER_WORDS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
  seven: 7, eight: 8, nine: 9, ten: 10, fifteen: 15, twenty: 20, thirty: 30,
  forty: 40, 'forty-five': 45, sixty: 60, ninety: 90,
};

const toNumber = (s: string): number => {
  const k = s.toLowerCase();
  return k in NUMBER_WORDS ? NUMBER_WORDS[k] : parseFloat(k);
};

const unitToMinutes = (unit: string): number => (/^h/i.test(unit) ? 60 : 1);

// ---------------------------------------------------------------- duration

const WORD_NUM = '(?:\\d+(?:\\.\\d+)?|an?|one|two|three|four|five|six|seven|eight|nine|ten|fifteen|twenty|thirty|forty-five|forty|sixty|ninety)';
const QUALIFIER = '(?:for|about|around|roughly|approx\\.?|approximately|takes?|taking|~)';

/** Spots wording that makes "2 hours" a point in time ("in 2 hours") rather than a length. */
const isRelativeTime = (text: string, m: RegExpExecArray): boolean => {
  const before = text.slice(0, m.index);
  const after = text.slice(m.index + m[0].length);
  return /\b(?:in|within|after|every|than|past)\s*$/i.test(before) || /^\s*(?:from now|later|ago|before|after)\b/i.test(after);
};

export function extractDuration(input: string): Extraction<number> {
  let text = input;

  // 1h30m, 1 h 30 min, ~1h30m
  let m = /(?<![\w.])~?\s*(\d+)\s*h(?:ours?|rs?)?\s*(?:and\s*)?(\d+)\s*m(?:in(?:ute)?s?)?\b/i.exec(text);
  if (m) return { value: +m[1] * 60 + +m[2], text: blank(text, m) };

  // an hour and a half
  m = /\b(?:an?|one)\s+hour\s+and\s+(?:a\s+)?half\b/i.exec(text);
  if (m) return { value: 90, text: blank(text, m) };

  // half an hour
  m = /\b(?:half\s+an?\s+hour|half\s+hour|30\s*-?\s*min(?:ute)?s?)\b/i.exec(text);
  if (m && !isRelativeTime(text, m)) return { value: 30, text: blank(text, m) };

  // qualified form: "for 2 hours", "about 45 minutes", "an hour"
  const qualified = new RegExp(`(?<![\\w.])${QUALIFIER}\\s*(${WORD_NUM})\\s*(hours?|hrs?|minutes?|mins?|h|m)\\b`, 'i');
  m = qualified.exec(text);
  if (m && !isRelativeTime(text, m)) {
    return { value: Math.round(toNumber(m[1]) * unitToMinutes(m[2])), text: blank(text, m) };
  }

  // bare numeric form: "2 hours", "90 min", "2h", "30m"
  const bare = /(?<![\w.:])(\d+(?:\.\d+)?)\s*(hours?|hrs?|minutes?|mins?)\b|(?<![\w.:])(\d+(?:\.\d+)?)([hm])\b/i;
  m = bare.exec(text);
  if (m && !isRelativeTime(text, m)) {
    const num = parseFloat(m[1] ?? m[3]);
    const unit = m[2] ?? m[4];
    return { value: Math.round(num * unitToMinutes(unit)), text: blank(text, m) };
  }

  return { value: undefined, text };
}

// ---------------------------------------------------------------- priority

const PRIORITY_ALIASES: Record<string, Priority> = {
  high: 'high', h: 'high', urgent: 'high', med: 'med', medium: 'med', m: 'med', normal: 'med', low: 'low', l: 'low',
};

export function extractPriority(input: string): Extraction<Priority> {
  const tag = /(?:^|\s)!(high|medium|med|low|h|m|l)\b/i.exec(input);
  if (tag) return { value: PRIORITY_ALIASES[tag[1].toLowerCase()], text: blank(input, tag) };

  const phrase = /\b(?:(high|medium|med|low|top)[\s-]*(?:priority|prio)|priority\s*(?:is\s*)?(high|medium|med|low))\b/i.exec(input);
  if (phrase) {
    const word = (phrase[1] ?? phrase[2]).toLowerCase();
    return { value: word === 'top' ? 'high' : PRIORITY_ALIASES[word], text: blank(input, phrase) };
  }

  const urgent = /\b(?:urgent(?:ly)?|asap|critical)\b/i.exec(input);
  if (urgent) return { value: 'high', text: blank(input, urgent) };

  const relaxed = /\b(?:not urgent|whenever|no rush|someday|when i have time)\b/i.exec(input);
  if (relaxed) return { value: 'low', text: blank(input, relaxed) };

  // "important" reads naturally inside a title, so it sets priority without being removed
  if (/\bimportant\b/i.test(input)) return { value: 'high', text: input };

  return { value: undefined, text: input };
}

// ---------------------------------------------------------------- category

export function extractCategoryTag(input: string): Extraction<string> {
  const m = /(?:^|\s)#([a-z][\w-]*)/i.exec(input);
  return m ? { value: m[1].toLowerCase(), text: blank(input, m) } : { value: undefined, text: input };
}

/** First matching rule wins, so more specific categories come first. */
const CATEGORY_RULES: Array<[string, RegExp]> = [
  ['health', /\b(dentist|doctor|dr\.|clinic|hospital|appointment|pharmacy|medicine|checkup|check-up|therapy|physio|optician)\b/i],
  ['fitness', /\b(gym|workout|work out|run|running|jog|yoga|swim|swimming|cycling|exercise|training|walk|stretch|cardio|lift)\b/i],
  ['study', /\b(assignment|homework|study|studying|exam|quiz|lecture|revise|revision|essay|thesis|physics|chemistry|maths?|biology|history|course|class|lab|tutorial|read(?:ing)? chapter|chapters?)\b/i],
  ['work', /\b(meeting|client|standup|stand-up|report|presentation|deploy|invoice|proposal|sprint|review|interview|email|emails|project|office|slides|deck|budget)\b/i],
  ['finance', /\b(pay|bill|bills|rent|tax|taxes|bank|invoice|salary|insurance|loan)\b/i],
  ['social', /\b(dinner|lunch|party|birthday|friends?|wedding|date night|hang ?out|coffee with|visit)\b/i],
  ['home', /\b(groceries|grocery|clean|cleaning|laundry|cook|cooking|dishes|vacuum|repair|fix|garden|trash|shopping|buy|errand|errands)\b/i],
  ['personal', /\b(call|mom|mum|dad|family|sister|brother|journal|meditat\w*|pray|prayer|read|book)\b/i],
];

export function inferCategory(title: string): string | undefined {
  for (const [cat, re] of CATEGORY_RULES) if (re.test(title)) return cat;
  return undefined;
}

// ---------------------------------------------------------------- calendar flag

export function extractCalendarFlag(input: string): Extraction<boolean> {
  const m = /\b(?:and\s+)?(?:please\s+)?(?:add|put|save|sync|schedule|pin)\s+(?:it|this|that)?\s*(?:to|on|in|into)\s+(?:my\s+)?(?:google\s+)?calendar\b/i.exec(input);
  return m ? { value: true, text: blank(input, m) } : { value: undefined, text: input };
}

// ---------------------------------------------------------------- recurrence

const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const FULL_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DAY_WORD = '(?:sun(?:day)?|mon(?:day)?|tue(?:s|sday)?|wed(?:nesday)?|thu(?:rs?|rsday)?|fri(?:day)?|sat(?:urday)?)';

const dayIndex = (word: string): number => WEEKDAYS.indexOf(word.slice(0, 3).toLowerCase());

/**
 * Replaces the recurrence phrase with the first weekday (when there is one) so
 * the date parser can still anchor the first occurrence ("every Monday at 6pm").
 */
export function extractRecurrence(input: string): Extraction<Recurrence> {
  let m = new RegExp(`\\b(?:every|each)\\s+(${DAY_WORD}(?:\\s*(?:,|and|&)\\s*${DAY_WORD})*)s?\\b`, 'i').exec(input);
  if (m) {
    const days = [...m[1].matchAll(new RegExp(DAY_WORD, 'gi'))].map((d) => dayIndex(d[0]));
    const unique = [...new Set(days)].sort();
    return {
      value: { freq: 'weekly', interval: 1, byDay: unique },
      text: input.slice(0, m.index) + ` ${FULL_NAMES[unique[0]]} ` + input.slice(m.index + m[0].length),
    };
  }

  m = /\b(?:every\s+weekday|weekdays|on weekdays)\b/i.exec(input);
  if (m) return { value: { freq: 'weekly', interval: 1, byDay: [1, 2, 3, 4, 5] }, text: blank(input, m) };

  m = /\bevery\s+(\d+|other)\s+(day|week|month)s?\b/i.exec(input);
  if (m) {
    const interval = m[1].toLowerCase() === 'other' ? 2 : parseInt(m[1], 10);
    const freq = m[2].toLowerCase() === 'day' ? 'daily' : m[2].toLowerCase() === 'week' ? 'weekly' : 'monthly';
    return { value: { freq, interval }, text: blank(input, m) };
  }

  m = /\b(?:every\s*day|daily|each day)\b/i.exec(input);
  if (m) return { value: { freq: 'daily', interval: 1 }, text: blank(input, m) };

  m = /\b(?:every\s+week|weekly)\b/i.exec(input);
  if (m) return { value: { freq: 'weekly', interval: 1 }, text: blank(input, m) };

  m = /\b(?:every\s+month|monthly)\b/i.exec(input);
  if (m) return { value: { freq: 'monthly', interval: 1 }, text: blank(input, m) };

  return { value: undefined, text: input };
}

// ---------------------------------------------------------------- @date tag

/** "@friday" or "@3pm" become plain words for the date parser. */
export const expandDateTags = (input: string): string => input.replace(/(^|\s)@(\S+)/g, '$1$2');
