import { describe, expect, it } from 'vitest';
import { parseInput } from '../src/lib/parser';
import type { ParsedTask } from '../src/lib/parser';
import { CTX, TZ, at } from './helpers';
import { endOfDayTz } from '../src/lib/time/tz';

const tasksOf = (input: string): ParsedTask[] => {
  const r = parseInput(input, CTX);
  if (r.kind !== 'tasks') throw new Error(`expected tasks for "${input}", got ${r.kind}`);
  return r.tasks;
};
const one = (input: string): ParsedTask => {
  const t = tasksOf(input);
  expect(t, `"${input}" should be a single task`).toHaveLength(1);
  return t[0];
};
const eod = (m: number, d: number) => endOfDayTz(at(m, d, 12), TZ);

describe('required examples', () => {
  it('Physics assignment with due date, duration and priority', () => {
    const t = one('Physics assignment due Thursday, about 2 hours, high priority');
    expect(t.title).toBe('Physics assignment');
    expect(t.dueAt).toBe(eod(10, 22));
    expect(t.durationMin).toBe(120);
    expect(t.priority).toBe('high');
    expect(t.category).toBe('study');
    expect(t.fixedStart).toBeUndefined();
  });

  it('splits a list into three tasks', () => {
    const t = tasksOf('Gym at 6pm, call mom, client meeting tomorrow 3 to 4');
    expect(t.map((x) => x.title)).toEqual(['Gym', 'Call mom', 'Client meeting']);
    expect(t[0].fixedStart).toBe(at(10, 19, 18));
    expect(t[0].fixedEnd).toBe(at(10, 19, 19));
    expect(t[1].fixedStart).toBeUndefined();
    expect(t[1].dueAt).toBeUndefined();
    expect(t[2].fixedStart).toBe(at(10, 20, 15));
    expect(t[2].fixedEnd).toBe(at(10, 20, 16));
  });

  it('Dentist with calendar flag', () => {
    const t = one('Dentist Friday 4pm add to my calendar');
    expect(t.title).toBe('Dentist');
    expect(t.fixedStart).toBe(at(10, 23, 16));
    expect(t.fixedEnd).toBe(at(10, 23, 17));
    expect(t.addToCalendar).toBe(true);
    expect(t.category).toBe('health');
  });
});

describe('dates and times', () => {
  it('treats "by <day> <time>" as a deadline, not an appointment', () => {
    const t = one('Submit report by Friday 5pm');
    expect(t.title).toBe('Submit report');
    expect(t.dueAt).toBe(at(10, 23, 17));
    expect(t.fixedStart).toBeUndefined();
  });

  it('handles relative times as deadlines', () => {
    const t = one('call dad in 2 hours');
    expect(t.title).toBe('Call dad');
    expect(t.dueAt).toBe(at(10, 19, 12));
    expect(t.durationMin).toBeUndefined();
  });

  it('parses an explicit appointment', () => {
    const t = one('Lunch with Sara tomorrow at 1pm');
    expect(t.title).toBe('Lunch with Sara');
    expect(t.fixedStart).toBe(at(10, 20, 13));
    expect(t.category).toBe('social');
  });

  it('parses an explicit range with minutes', () => {
    const t = one('Meeting with Ahmed tomorrow from 2 to 3:30pm');
    expect(t.fixedStart).toBe(at(10, 20, 14));
    expect(t.fixedEnd).toBe(at(10, 20, 15, 30));
    expect(t.durationMin).toBe(90);
  });

  it('assumes pm for small hours without a meridiem', () => {
    expect(one('Call the bank at 3 tomorrow').fixedStart).toBe(at(10, 20, 15));
  });

  it('keeps am hours for 9 and above', () => {
    expect(one('Meet Sam tomorrow at 9').fixedStart).toBe(at(10, 20, 9));
  });

  it('uses the end of day for date-only deadlines', () => {
    expect(one('Renew passport by Oct 30').dueAt).toBe(eod(10, 30));
  });

  it('uses the @ tag as a date', () => {
    const t = one('Pay electricity bill @friday');
    expect(t.title).toBe('Pay electricity bill');
    expect(t.dueAt).toBe(eod(10, 23));
    expect(t.category).toBe('finance');
  });

  it('handles "due <day> <time>" with trailing duration', () => {
    const t = one('Prepare presentation, due Monday 9am, 3 hours');
    expect(t.title).toBe('Prepare presentation');
    expect(t.dueAt).toBe(at(10, 26, 9));
    expect(t.durationMin).toBe(180);
  });

  it('moves a past time-of-day to the next day', () => {
    expect(one('Gym at 7am').fixedStart).toBe(at(10, 20, 7));
  });

  it('works for other timezones', () => {
    const ctx = { now: at(10, 19, 10, 0, 'America/New_York'), timezone: 'America/New_York' };
    const r = parseInput('Dentist tomorrow 4pm', ctx);
    if (r.kind !== 'tasks') throw new Error('expected tasks');
    expect(r.tasks[0].fixedStart).toBe(at(10, 20, 16, 0, 'America/New_York'));
  });
});

describe('durations', () => {
  it.each([
    ['Write essay for 2 hours', 120],
    ['Write essay about 45 minutes', 45],
    ['Write essay ~30m', 30],
    ['Write essay ~1h30m', 90],
    ['Write essay 1.5 hours', 90],
    ['Write essay for an hour', 60],
    ['Write essay for half an hour', 30],
    ['Write essay 2h', 120],
  ])('%s -> %i min', (input, minutes) => {
    const t = one(input);
    expect(t.durationMin).toBe(minutes);
    expect(t.title).toBe('Write essay');
  });
});

describe('priority and category tags', () => {
  it.each([
    ['Write essay !high', 'high'],
    ['Write essay !med', 'med'],
    ['Write essay !low', 'low'],
    ['Write essay low priority', 'low'],
    ['Write essay medium priority', 'med'],
    ['Write essay ASAP', 'high'],
    ['Write essay urgent', 'high'],
  ])('%s -> %s', (input, priority) => {
    const t = one(input);
    expect(t.priority).toBe(priority);
    expect(t.title).toBe('Write essay');
  });

  it('applies #category over inferred category', () => {
    const t = one('Study chemistry ~90m #exam !high');
    expect(t).toMatchObject({ title: 'Study chemistry', category: 'exam', priority: 'high', durationMin: 90 });
  });

  it('infers categories from keywords', () => {
    expect(one('Go to the gym').category).toBe('fitness');
    expect(one('buy milk').category).toBe('home');
    expect(one('call mom').category).toBe('personal');
    expect(one('Client meeting').category).toBe('work');
  });
});

describe('recurrence', () => {
  it('every weekday', () => {
    const t = one('Team standup every weekday at 9am');
    expect(t.recurrence).toEqual({ freq: 'weekly', interval: 1, byDay: [1, 2, 3, 4, 5] });
    expect(t.title).toBe('Team standup');
  });

  it('several named days', () => {
    const t = one('gym every Monday and Wednesday at 6pm');
    expect(t.recurrence).toEqual({ freq: 'weekly', interval: 1, byDay: [1, 3] });
    expect(t.title).toBe('Gym');
    expect(t.fixedStart).toBe(at(10, 19, 18));
  });

  it('daily and every N days', () => {
    expect(one('Yoga daily').recurrence).toEqual({ freq: 'daily', interval: 1 });
    expect(one('Water the plants every 3 days').recurrence).toEqual({ freq: 'daily', interval: 3 });
  });
});

describe('splitting lists', () => {
  it('comma separated', () => {
    expect(tasksOf('plan trip, book flights, pack bags').map((t) => t.title)).toEqual([
      'Plan trip',
      'Book flights',
      'Pack bags',
    ]);
  });

  it('"and" before a verb', () => {
    expect(tasksOf('Dentist tomorrow 3pm and buy groceries').map((t) => t.title)).toEqual([
      'Dentist',
      'Buy groceries',
    ]);
    expect(tasksOf('Review pull requests and update docs tomorrow')).toHaveLength(2);
  });

  it('keeps "and" inside a title', () => {
    expect(one('salt and pepper').title).toBe('Salt and pepper');
  });

  it('bulleted and numbered multi-line paste', () => {
    const t = tasksOf('- gym at 6pm\n- email professor\n1. finish lab report friday');
    expect(t.map((x) => x.title)).toEqual(['Gym', 'Email professor', 'Finish lab report']);
    expect(t[2].dueAt).toBe(eod(10, 23));
  });

  it('glues attribute-only fragments back onto the previous task', () => {
    const t = tasksOf('Write proposal, 2 hours, high priority, call Ali');
    expect(t).toHaveLength(2);
    expect(t[0]).toMatchObject({ title: 'Write proposal', durationMin: 120, priority: 'high' });
  });
});

describe('filler words and edge cases', () => {
  it('strips "remind me to"', () => {
    const t = one('remind me to take medicine at 8pm');
    expect(t.title).toBe('Take medicine');
    expect(t.fixedStart).toBe(at(10, 19, 20));
  });

  it('strips "I need to"', () => {
    expect(one('I need to renew passport').title).toBe('Renew passport');
  });

  it('returns empty for blank input', () => {
    expect(parseInput('', CTX).kind).toBe('empty');
    expect(parseInput('   \n ', CTX).kind).toBe('empty');
  });

  it('returns empty when only attributes were typed', () => {
    expect(parseInput('tomorrow 3pm', CTX).kind).toBe('empty');
  });
});

describe('sentences that look like commands but are tasks', () => {
  it('"Move boxes to garage" has no date so it is a task', () => {
    expect(one('Move boxes to garage').title).toBe('Move boxes to garage');
  });
  it('"Work on thesis tomorrow" is a task', () => {
    expect(one('Work on thesis tomorrow').title).toBe('Work on thesis');
  });
  it('"Finish report by Friday" is a task', () => {
    expect(one('Finish report by Friday').title).toBe('Finish report');
  });
});
