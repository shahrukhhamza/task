import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { clearAllData } from '../src/lib/db/actions';
import { db } from '../src/lib/db/schema';
import { parseInput } from '../src/lib/parser';
import { normalizeMeridiems } from '../src/lib/parser/spokenTime';
import { numberedTasks, numberMap, parseNumberRef } from '../src/lib/taskNumbers';
import { createVoiceAgent } from '../src/lib/voice/agent';
import { CTX, NOW, TZ, at, makeTask } from './helpers';

describe('task numbers', () => {
  it('number active tasks soonest first', () => {
    const later = makeTask({ id: 'later', title: 'Later', fixedStart: at(10, 20, 9), fixedEnd: at(10, 20, 10), status: 'scheduled' });
    const soon = makeTask({ id: 'soon', title: 'Soon', fixedStart: at(10, 19, 15), fixedEnd: at(10, 19, 16), status: 'scheduled' });
    const planned = makeTask({ id: 'planned', title: 'Planned', status: 'scheduled', blocks: [{ id: 'b', taskId: 'planned', start: at(10, 19, 11), end: at(10, 19, 12), chunk: 1, chunks: 1 }] });
    const deadline = makeTask({ id: 'deadline', title: 'Deadline', dueAt: at(10, 22, 18) });
    const loose = makeTask({ id: 'loose', title: 'Loose' });
    const done = makeTask({ id: 'done', title: 'Done', status: 'done', fixedStart: at(10, 19, 8) });
    const gone = makeTask({ id: 'gone', title: 'Gone', fixedStart: at(10, 19, 7), deletedAt: 1 });
    expect(numberedTasks([later, loose, soon, done, gone, deadline, planned]).map((t) => t.id)).toEqual(['planned', 'soon', 'later', 'deadline', 'loose']);
    expect([...numberMap([later, soon]).entries()]).toEqual([
      ['soon', 1],
      ['later', 2],
    ]);
  });

  it.each([
    ['2', 2],
    ['#2', 2],
    ['task 2', 2],
    ['number 3', 3],
    ['no. 4', 4],
    ['no 4', 4],
    ['item 5', 5],
    ['task #6', 6],
    ['the second task', 2],
    ['second one', 2],
    ['second', 2],
    ['3rd', 3],
    ['number two', 2],
    ['task three', 3],
    ['the first one', 1],
    ['#12', 12],
  ])('reads "%s" as %d', (text, n) => {
    expect(parseNumberRef(text)).toBe(n);
  });

  it.each(['gym', 'call mom', 'one', 'two', 'meeting 2', 'number', 'task', '0', ''])('leaves "%s" alone', (text) => {
    expect(parseNumberRef(text)).toBeUndefined();
  });
});

describe('"p.m." is not left as ".m"', () => {
  it('normalises dotted am/pm', () => {
    expect(normalizeMeridiems('meeting at 6 p.m.')).toBe('meeting at 6 pm');
    expect(normalizeMeridiems('from 8 a.m. to 9 p.m. tomorrow')).toBe('from 8 am to 9 pm tomorrow');
    expect(normalizeMeridiems('6 P.M')).toBe('6 pm');
    expect(normalizeMeridiems('keep the same')).toBe('keep the same');
  });

  it.each(['dentist at 4 p.m.', 'dentist at 4 p.m', 'dentist at 4 pm.', 'dentist at 4 PM'])('%s -> Dentist 4 pm', (input) => {
    const r = parseInput(input, CTX);
    expect(r.kind).toBe('tasks');
    if (r.kind === 'tasks') {
      expect(r.tasks[0].title).toBe('Dentist');
      expect(r.tasks[0].fixedStart).toBe(at(10, 19, 16));
    }
  });
});

describe('talking about tasks by number', () => {
  const agent = () => createVoiceAgent({ understand: async (text, ctx) => parseInput(text, ctx), smart: false, now: () => NOW });
  const live = async () => numberedTasks(await db.tasks.toArray());
  const titles = async () => (await live()).map((t) => t.title);

  beforeEach(async () => {
    await clearAllData();
    await db.profile.put({ ...(await db.profile.get('me')), id: 'me', timezone: TZ } as never);
  });

  async function three() {
    const a = agent();
    await a.hear('dentist at 4 pm');
    await a.hear('gym at 6 pm');
    await a.hear('dinner at 8 pm');
    return a;
  }

  it('tells you the number of what it just added', async () => {
    const a = agent();
    expect((await a.hear('dentist at 4 pm')).say).toBe('Added “Dentist” (task 1), today from 4:00 PM to 5:00 PM.');
    expect((await a.hear('gym at 6 pm')).say).toContain('(task 2)');
    // numbers follow the time of day, so a 5 pm meeting slots in before the gym
    expect((await a.hear('add a meeting at 5 pm')).say).toContain('(task 2)');
  });

  it('reads the day out with numbers', async () => {
    const a = await three();
    expect((await a.hear("what's on my schedule today")).say).toBe('Today you have task 1, Dentist at 4:00 PM, task 2, Gym at 6:00 PM and task 3, Dinner at 8:00 PM.');
  });

  it.each(['delete task 2', 'delete number 2', 'delete #2', 'remove the second task', 'cancel task two'])('"%s" removes the gym', async (phrase) => {
    const a = await three();
    await a.hear(phrase);
    expect(await titles()).toEqual(['Dentist', 'Dinner']);
  });

  it('updates a numbered task', async () => {
    const a = await three();
    const turn = await a.hear('update task 2 to 9 pm');
    expect(turn.tone).toBe('ok');
    expect(turn.say).toContain('"Gym"');
    const gym = (await live()).find((t) => t.title === 'Gym')!;
    expect(gym.fixedStart).toBe(at(10, 19, 21));
    expect(await titles()).toHaveLength(3);
  });

  it('marks a numbered task done, and the numbers move up', async () => {
    const a = await three();
    await a.hear('mark task 1 as done');
    expect(await titles()).toEqual(['Gym', 'Dinner']);
    await a.hear('delete task 1'); // the gym is task 1 now
    expect(await titles()).toEqual(['Dinner']);
  });

  it('moves and renames by number', async () => {
    const a = await three();
    await a.hear('move task 3 to tomorrow');
    await a.hear('rename task 1 to root canal');
    const all = await db.tasks.toArray();
    expect(all.find((t) => t.title === 'Root canal')).toBeDefined();
    expect(all.find((t) => t.title === 'Dinner')!.fixedStart).toBe(at(10, 20, 20));
  });

  it('says so when there is no such number', async () => {
    const a = await three();
    const turn = await a.hear('delete task 9');
    expect(turn.tone).toBe('error');
    expect(turn.say).toBe("There's no task number 9. You have 3.");
    expect(await titles()).toHaveLength(3);
  });

  it('still finds tasks by name', async () => {
    const a = agent();
    await a.hear('call mom at 7 pm');
    await a.hear('delete call mom');
    expect(await titles()).toEqual([]);
  });

  it('offers the numbers when two tasks match, and accepts one as the answer', async () => {
    const a = agent();
    await a.hear('call mom at 5 pm');
    await a.hear('call dentist at 6 pm');
    const ask = await a.hear('delete call');
    expect(ask.options).toEqual(['Call mom (#1)', 'Call dentist (#2)']);
    await a.hear('number 2');
    expect(await titles()).toEqual(['Call mom']);
  });

  it('understands "but no, update that meeting 6 pm" after a clumsy first try', async () => {
    const a = agent();
    await a.hear('meeting at 5 pm');
    const turn = await a.hear('But no update that meeting 6 p.m.');
    expect(turn.tone).toBe('ok');
    const all = await db.tasks.toArray();
    expect(all).toHaveLength(1);
    expect(all[0].fixedStart).toBe(at(10, 19, 18));
  });

  it('a spoken "p.m." keeps its title clean', async () => {
    const a = agent();
    await a.hear('add a meeting from 6 p.m. to 6:30 p.m.');
    const [t] = await db.tasks.toArray();
    expect(t.title).toBe('Meeting');
    expect(t.fixedEnd! - t.fixedStart!).toBe(30 * 60_000);
  });
});
