import { startOfDayTz } from '../time/tz';
import { parseDates } from './chronoTz';
import { parseChange, parseFromMinutes } from './changes';
import type { ParseContext, ParsedCommand, TaskChange } from './types';

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

/** Leading chatter that doesn't change what is being asked: "actually, ...", "can you please ...". */
const FILLER = /^(?:(?:actually|no|nope|sorry|wait|oops|um|uh|hmm|oh|okay|ok|well|hey|so)[,.!\s]+)+/i;
const ASKING = /^(?:(?:please|kindly)\s+|(?:can|could|would|will)\s+you\s+(?:please\s+)?|i\s+(?:want|need|would\s+like|wanna)\s+to\s+|i'?d\s+like\s+to\s+)+/i;

const EDIT_VERBS = '(?:update|change|edit|modify|adjust|correct|amend|alter|fix|retime|set)';
/** These already mean "move" elsewhere; they only count as an edit when the sentence names the old time. */
const MOVE_VERBS = '(?:reschedule|shift|move|push|postpone|delay|defer)';

const UPDATE = new RegExp(
  String.raw`^(${EDIT_VERBS}|${MOVE_VERBS})\s+(?:the\s+|my\s+)?(?:(?:start\s+|end\s+)?(?:time|timing|schedule|date|duration|length)\s+(?:of|for)\s+)?(?:the\s+|my\s+)?(.+?)(?:'s)?(?:\s+(?:start\s+)?(?:time|timing|schedule|date))?(?:\s+from\s+(.+?))?\s+(?:to|till|until|for|at|by)\s+(.+)$`,
);

/** "update the meeting from 6 pm to 7 pm", "change it to 7 pm", "reschedule the dentist from 4 to 5". */
function parseUpdate(lower: string, ctx: ParseContext): ParsedCommand | null {
  const m = UPDATE.exec(lower);
  if (!m) return null;
  const [, verb, rawTarget, from, to] = m;
  const isMove = new RegExp(`^${MOVE_VERBS}$`).test(verb);
  const fromTime = from ? parseFromMinutes(from, ctx) : undefined;
  if (isMove && !fromTime) return null;

  const change = parseChange(to, ctx);
  if (!change) return null;
  if (fromTime) {
    change.fromMin = fromTime.min;
    if (fromTime.guessed) change.ampmGuessed = true;
    if (change.startMin !== undefined && change.endMin === undefined) change.asRange = { startMin: fromTime.min, endMin: change.startMin };
  }
  // "change the time to 7 pm": "the time" is what changes, not the task's name
  const target = /^(?:time|timing|schedule|date|start time|end time|duration|length)$/.test(clean(rawTarget)) ? '' : clean(rawTarget);
  return { kind: 'update', target, change, soft: verb === 'set' && !/^(?:it|this|that)$/.test(target) ? true : undefined };
}

/** "make the meeting from 5 to 6", "make it 7 pm", "make it 30 minutes", "mark gym as high priority". */
function parseMake(lower: string, ctx: ParseContext): ParsedCommand | null {
  let m = /^(?:make|mark|set)\s+(?:the\s+|my\s+)?(.+?)\s+(?:as\s+)?(?:(high|low|medium|med|top)[\s-]*priority|(urgent))$/.exec(lower);
  if (m) {
    const word = (m[2] ?? 'high').toLowerCase();
    const change: TaskChange = { priority: word === 'low' ? 'low' : word === 'medium' || word === 'med' ? 'med' : 'high' };
    return { kind: 'update', target: clean(m[1]), change };
  }

  m = /^(?:make|have|put)\s+(?:the\s+|my\s+)?(.+?)\s+(?:be\s+)?((?:from|at|between|for|to|starting)\s+.+|\d.*|(?:half\s+an?\s+hour|an?\s+hour).*)$/.exec(lower);
  if (!m) return null;
  const change = parseChange(m[2], ctx);
  return change ? { kind: 'update', target: clean(m[1]), change, soft: true } : null;
}

/** "the meeting is now at 7 pm", "meeting has been moved to 7", "dentist should be at 5". */
function parseStatement(lower: string, ctx: ParseContext): ParsedCommand | null {
  const m = /^(?:the\s+|my\s+)?(.+?)\s+(?:(?:is|are|has\s+been|got|will\s+be)\s+(?:now\s+|moved\s+to\s+|rescheduled\s+to\s+|changed\s+to\s+|pushed\s+to\s+)|should\s+be\s+)(?:at\s+|from\s+|to\s+)?(.+)$/.exec(lower);
  if (!m) return null;
  const change = parseChange(m[2], ctx);
  return change && (change.startMin !== undefined || change.day !== undefined) ? { kind: 'update', target: clean(m[1]), change } : null;
}

/** "rename gym to workout": the new name keeps the capitals the user spoke or typed. */
function parseRename(text: string): ParsedCommand | null {
  const m =
    /^(?:rename)\s+(?:the\s+|my\s+)?(.+?)\s+(?:to|as)\s+(.+)$/i.exec(text) ??
    /^(?:change|update|edit)\s+(?:the\s+)?(?:name|title)\s+of\s+(?:the\s+|my\s+)?(.+?)\s+to\s+(.+)$/i.exec(text);
  if (!m) return null;
  const title = m[2].trim().replace(/^["“']|["”']$/g, '');
  if (!title) return null;
  return { kind: 'update', target: clean(m[1].toLowerCase()), change: { title: title.charAt(0).toUpperCase() + title.slice(1) } };
}

/**
 * Returns a command when the sentence is addressed at existing tasks.
 * Anything that doesn't match falls through to normal task parsing.
 */
export function parseCommand(input: string, ctx: ParseContext): ParsedCommand | null {
  const text = input.trim().replace(/[.!]+$/, '').replace(/\s+/g, ' ').replace(FILLER, '');
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

  // changing an existing task: "update the meeting from 6 pm to 7 pm", "make it 30 minutes", "rename gym to workout"
  const asking = lower.replace(ASKING, '');
  const edit = parseRename(text.replace(ASKING, '')) ?? parseUpdate(asking, ctx) ?? parseMake(asking, ctx) ?? parseStatement(asking, ctx);
  if (edit) return edit;

  // "push gym to tomorrow", "move dentist to 5pm"
  m = /^(?:please\s+|can you\s+)?(?:push|postpone|move|reschedule|shift|delay|defer)\s+(?:back\s+)?(?:the\s+|my\s+)?(.+?)\s+(?:to|until|till|for|onto)\s+(.+)$/.exec(lower);
  if (m) {
    const parsed = parseDates(m[2], ctx)[0];
    // "move dentist to 5pm" keeps the dentist's own day; only a named day ("tomorrow at 5") moves it to another
    if (parsed?.hasTime && !parsed.dateCertain) {
      const change = parseChange(m[2], ctx);
      if (change) return { kind: 'update', target: clean(m[1]), change };
    }
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

  // "add gym to my calendar" for a task that already exists; with a date it's a new task instead
  m = /^(?:please\s+)?(?:add|put|sync|save)\s+(?:the\s+|my\s+)?(.+?)\s+(?:to|on|in|into)\s+(?:my\s+)?(?:google\s+)?calendar$/.exec(lower);
  if (m && parseDates(m[1], ctx).length === 0) return { kind: 'calendar', target: clean(m[1]) };

  // "delete call mom"
  m = /^(?:please\s+)?(?:delete|remove|cancel|drop|scrap|trash|get\s+rid\s+of|forget\s+about)\s+(?:the\s+|my\s+)?(.+)$/.exec(lower);
  if (m) return { kind: 'delete', target: clean(m[1]) };

  return null;
}
