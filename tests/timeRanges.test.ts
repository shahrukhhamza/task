import { describe, expect, it } from 'vitest';
import { applySpokenTimes } from '../src/lib/ai/guard';
import { toParsedTask } from '../src/lib/ai/convert';
import { parseInput } from '../src/lib/parser';
import type { ParsedTask } from '../src/lib/parser';
import { normalizeDayParts, spokenTimes } from '../src/lib/parser/spokenTime';
import { CTX, TZ, at } from './helpers';

const one = (input: string): ParsedTask => {
  const r = parseInput(input, CTX);
  if (r.kind !== 'tasks') throw new Error(`expected tasks for "${input}", got ${r.kind}`);
  expect(r.tasks).toHaveLength(1);
  return r.tasks[0];
};

describe('time ranges in the rule parser', () => {
  // NOW is Monday 19 Oct 10:00, so a morning start rolls to tomorrow and an evening one stays today
  it.each([
    ['meeting from 8 AM to 9PM', [20, 8], [20, 21]],
    ['meeting from 8 AM to 9 PM', [20, 8], [20, 21]],
    ['meeting from 8 a.m. to 9 p.m.', [20, 8], [20, 21]],
    ['meeting from 8:30 AM until 9:30 PM', [20, 8, 30], [20, 21, 30]],
    ['meeting from 8 to 9 pm', [19, 20], [19, 21]],
    ['meeting 8 am to 9', [20, 8], [20, 9]],
    ['class from 6 to 7 am', [20, 6], [20, 7]],
    ['meeting 3 to 4 pm', [19, 15], [19, 16]],
    ['meeting from 8 in the morning to 9 in the evening', [20, 8], [20, 21]],
    ['meeting from 8 AM to 9 at night', [20, 8], [20, 21]],
  ] as Array<[string, number[], number[]]>)('%s', (input, start, end) => {
    const t = one(input);
    expect(t.title).toBe(input.startsWith('class') ? 'Class' : 'Meeting');
    expect(t.fixedStart).toBe(at(10, start[0], start[1], start[2] ?? 0));
    expect(t.fixedEnd).toBe(at(10, end[0], end[1], end[2] ?? 0));
  });

  it('keeps "8 AM to 9PM" as a 13 hour block, not one hour', () => {
    const t = one('meeting from 8 AM to 9PM');
    expect(t.fixedStart).toBe(at(10, 20, 8));
    expect(t.fixedEnd).toBe(at(10, 20, 21));
    expect(t.durationMin).toBe(13 * 60);
  });

  it('a bare end time takes the next matching clock face', () => {
    expect(one('lunch 12 to 1').fixedEnd! - one('lunch 12 to 1').fixedStart!).toBe(60 * 60_000);
    expect(one('office 9 to 5').durationMin).toBe(8 * 60);
    expect(one('party 10 pm to 2').durationMin).toBe(4 * 60);
  });

  it('does not put "add a" into the title', () => {
    const t = one('add a meeting from 5 am to 6 am');
    expect(t.title).toBe('Meeting');
    expect(t.fixedStart).toBe(at(10, 20, 5));
    expect(t.fixedEnd).toBe(at(10, 20, 6));
  });

  it.each([
    ['create a task to call mom at 5', 'Call mom'],
    ['schedule a call with Sam tomorrow at 3', 'Call with Sam'],
    ['add milk', 'Milk'],
  ])('%s -> %s', (input, title) => {
    expect(one(input).title).toBe(title);
  });

  it('still reads "add ... to my calendar" as a calendar request', () => {
    const t = one('add dentist Friday 4pm to my calendar');
    expect(t.title).toBe('Dentist');
    expect(t.addToCalendar).toBe(true);
  });
});

describe('spoken times', () => {
  it('turns day-part words into am/pm', () => {
    expect(normalizeDayParts('8 in the morning to 9 at night')).toBe('8 am to 9 pm');
    expect(normalizeDayParts('12 at night')).toBe('12 am');
    expect(normalizeDayParts('5 in the evening')).toBe('5 pm');
  });

  it('reads ranges and points', () => {
    expect(spokenTimes('meeting from 8 AM to 9PM')).toEqual([{ start: 480, end: 1260 }]);
    expect(spokenTimes('from 5 am to 6 am')).toEqual([{ start: 300, end: 360 }]);
    expect(spokenTimes('from 8 to 9 pm')).toEqual([{ start: 1200, end: 1260 }]);
    expect(spokenTimes('from 11 to 1 pm')).toEqual([{ start: 660, end: 780 }]);
    expect(spokenTimes('gym at 6pm and call at 7:30 am')).toEqual([{ start: 1080 }, { start: 450 }]);
    expect(spokenTimes('finish 3 things by 5')).toEqual([]);
  });
});

describe('guard against a model that gets am/pm wrong', () => {
  const ai = (t: object) => toParsedTask({ title: 'Meeting', kind: 'fixed', priority: 'med', category: 'work', ...t }, CTX)!;

  it('fixes an end time the model wrote as 09:00 for "9PM"', () => {
    const wrong = ai({ date: '2026-10-19', time: '08:00', endTime: '09:00' });
    expect(wrong.fixedEnd).toBe(at(10, 19, 9));
    const [fixed] = applySpokenTimes([wrong], 'I have a meeting from 8 AM to 9PM', TZ);
    expect(fixed.fixedStart).toBe(at(10, 19, 8));
    expect(fixed.fixedEnd).toBe(at(10, 19, 21));
    expect(fixed.durationMin).toBe(13 * 60);
  });

  it('fixes a start the model moved to the wrong half of the day', () => {
    const wrong = ai({ date: '2026-10-19', time: '17:00', endTime: '18:00' });
    const [fixed] = applySpokenTimes([wrong], 'add a meeting from 5 am to 6 am', TZ);
    expect(fixed.fixedStart).toBe(at(10, 19, 5));
    expect(fixed.fixedEnd).toBe(at(10, 19, 6));
  });

  it('moves a single time without changing its length', () => {
    const wrong = ai({ date: '2026-10-19', time: '09:00', endTime: '10:00' });
    const [fixed] = applySpokenTimes([wrong], 'dinner meeting at 9pm', TZ);
    expect(fixed.fixedStart).toBe(at(10, 19, 21));
    expect(fixed.fixedEnd).toBe(at(10, 19, 22));
  });

  it('leaves correct answers and unrelated tasks alone', () => {
    const right = ai({ date: '2026-10-19', time: '08:00', endTime: '21:00' });
    expect(applySpokenTimes([right], 'meeting from 8 AM to 9PM', TZ)[0]).toBe(right);
    const other = ai({ date: '2026-10-19', time: '15:00', endTime: '16:00' });
    expect(applySpokenTimes([other], 'meeting from 8 AM to 9PM', TZ)[0]).toBe(other);
    expect(applySpokenTimes([other], 'no times here', TZ)[0]).toBe(other);
  });
});

describe('short meetings keep the length you said', () => {
  it.each([
    ['meeting from 6 pm to 6:30', 30],
    ['meeting from 6 pm to 6:30 pm', 30],
    ['meeting from 6 to 6:30 pm', 30],
    ['I have a meeting from 6 pm to 6:30', 30],
    ['meeting 6pm-6:30pm', 30],
    ['meeting from 6 pm to 6:15', 15],
    ['meeting from 6 pm to 6:45', 45],
    ['meeting at 6 pm for 30 minutes', 30],
    ['meeting at 6pm', 60],
  ])('rule parser: %s -> %d min', (input, minutes) => {
    const t = one(input);
    expect(t.fixedStart).toBe(at(10, 19, 18));
    expect(t.durationMin).toBe(minutes);
    expect(t.fixedEnd).toBe(at(10, 19, 18) + minutes * 60_000);
  });

  // a model that forgets the end time would otherwise fall back to a full hour
  const forgetful = () => toParsedTask({ title: 'Meeting', kind: 'fixed', date: '2026-10-19', time: '18:00', priority: 'med', category: 'work' }, CTX)!;
  it.each([
    ['meeting from 6 pm to 6:30', 30],
    ['I have a meeting from 6 PM to 6:30 PM', 30],
    ['meeting from 6 p.m. to 6:30 p.m.', 30],
    ['meeting from 6 to 6:30', 30],
    ['meeting from 6 pm to 6.30 pm', 30],
    ['meeting at 6 pm for half an hour', 30],
    ['meeting at 6pm for 45 minutes', 45],
  ])('guard fills in the length: %s -> %d min', (raw, minutes) => {
    const [fixed] = applySpokenTimes([forgetful()], raw, TZ);
    expect(fixed.fixedStart).toBe(at(10, 19, 18));
    expect(fixed.fixedEnd).toBe(at(10, 19, 18) + minutes * 60_000);
    expect(fixed.durationMin).toBe(minutes);
  });

  it('shrinks a model answer that rounded half an hour up to an hour', () => {
    const rounded = toParsedTask({ title: 'Meeting', kind: 'fixed', date: '2026-10-19', time: '18:00', endTime: '19:00', priority: 'med', category: 'work' }, CTX)!;
    expect(rounded.durationMin).toBe(60);
    expect(applySpokenTimes([rounded], 'meeting from 6 pm to 6:30', TZ)[0].durationMin).toBe(30);
  });

  it('does not treat other number ranges as times', () => {
    expect(spokenTimes('read pages 3 to 5')).toEqual([]);
    expect(spokenTimes('meeting from 6 to 6:30')).toEqual([{ start: 360, end: 390, bare: true }]);
    const t = forgetful();
    expect(applySpokenTimes([t], 'read pages 6 to 8 later', TZ)[0]).toBe(t);
  });

  it('leaves an hour alone when nothing shorter was said', () => {
    const t = forgetful();
    expect(applySpokenTimes([t], 'meeting at 6 pm', TZ)[0]).toBe(t);
  });
});
