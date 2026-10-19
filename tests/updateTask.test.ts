import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { toParseResult } from '../src/lib/ai/convert';
import { applySpokenChange } from '../src/lib/ai/guard';
import { applyChange } from '../src/lib/changeTask';
import { clearAllData } from '../src/lib/db/actions';
import { db } from '../src/lib/db/schema';
import { parseCommand, parseInput, parseTasksOnly } from '../src/lib/parser';
import { asUpdate } from '../src/lib/updateIntent';
import { createVoiceAgent } from '../src/lib/voice/agent';
import { CTX, NOW, TZ, at, makeTask } from './helpers';

const agent = () => createVoiceAgent({ understand: async (text, ctx) => parseInput(text, ctx), smart: false, now: () => NOW });
const live = async () => (await db.tasks.toArray()).filter((t) => !t.deletedAt);
const only = async () => {
  const tasks = await live();
  expect(tasks).toHaveLength(1);
  return tasks[0];
};

beforeEach(async () => {
  await clearAllData();
  await db.profile.put({ ...(await db.profile.get('me')), id: 'me', timezone: TZ } as never);
});

describe('updating an existing task by voice never creates a second one', () => {
  it.each([
    ['update the time of my meeting from 6 pm to 7 pm', [19, 20]],
    ['update meeting time from 6 pm to 7 pm', [19, 20]],
    ['change the meeting from 6 pm to 7 pm', [19, 20]],
    ['move my meeting from 6 pm to 7 pm', [19, 20]],
    ['change the meeting to 7 pm', [19, 20]],
    ['change meeting to 7', [19, 20]],
    ['reschedule the meeting to 7 pm', [19, 20]],
    ['move meeting to 7 pm', [19, 20]],
    ['edit the meeting time to 7 pm', [19, 20]],
    ['can you please change my meeting to 7 pm', [19, 20]],
    ['I want to change the meeting from 6 to 7', [19, 20]],
    ['the meeting is now at 7 pm', [19, 20]],
    ['meeting has been moved to 7', [19, 20]],
    ['actually, change the meeting to 7 pm', [19, 20]],
    ['make the meeting from 7 pm to 8 pm', [19, 20]],
    ['update meeting time to 7 to 7:30 pm', [19, 19.5]],
  ] as Array<[string, [number, number]]>)('%s', async (phrase, [start, end]) => {
    const a = agent();
    await a.hear('meeting from 6 pm to 7 pm');
    const turn = await a.hear(phrase);
    expect(turn.tone).toBe('ok');
    const task = await only(); // still exactly one task
    expect(task.fixedStart).toBe(at(10, 19, Math.floor(start), (start % 1) * 60));
    expect(task.fixedEnd).toBe(at(10, 19, Math.floor(end), (end % 1) * 60));
  });

  it('says what changed', async () => {
    const a = agent();
    await a.hear('meeting from 6 pm to 7 pm');
    expect((await a.hear('change meeting to 8 pm')).say).toBe('Updated "Meeting": today from 8:00 PM to 9:00 PM.');
  });

  it('keeps the length unless a new one is given', async () => {
    const a = agent();
    await a.hear('meeting from 6 pm to 6:30 pm');
    await a.hear('change meeting to 8 pm');
    const t = await only();
    expect(t.fixedEnd! - t.fixedStart!).toBe(30 * 60_000);
  });

  it('takes a new range as the new length', async () => {
    const a = agent();
    await a.hear('meeting from 6 pm to 7 pm');
    await a.hear('change the meeting to 6 pm to 6:30');
    const t = await only();
    expect(t.fixedStart).toBe(at(10, 19, 18));
    expect(t.fixedEnd).toBe(at(10, 19, 18, 30));
  });

  it('"it" and "this" mean the task you were just talking about', async () => {
    const a = agent();
    await a.hear('add a meeting from 6 pm to 7 pm');
    await a.hear('change it to 7 pm');
    expect((await only()).fixedStart).toBe(at(10, 19, 19));
    await a.hear('make it 30 minutes');
    const t = await only();
    expect(t.fixedEnd! - t.fixedStart!).toBe(30 * 60_000);
  });

  it('a time with no am/pm follows the task: 7 is 7 pm for an evening meeting, not 7 am', async () => {
    const a = agent();
    await a.hear('meeting from 6 pm to 7 pm');
    await a.hear('change meeting from 6 to 7');
    expect((await only()).fixedStart).toBe(at(10, 19, 19));
  });

  it('and 7 stays morning for a morning task', async () => {
    const a = agent();
    await a.hear('standup at 8 am');
    await a.hear('change standup to 9');
    // "standup at 8 am" said at 10:00 is tomorrow; the edit keeps that day and stays in the morning
    expect((await only()).fixedStart).toBe(at(10, 20, 9));
  });

  it('stays on the task’s own day unless another is named', async () => {
    const a = agent();
    await a.hear('meeting tomorrow from 6 pm to 7 pm');
    await a.hear('change the meeting to 8 pm');
    expect((await only()).fixedStart).toBe(at(10, 20, 20));
    await a.hear('move the meeting to friday');
    expect((await only()).fixedStart).toBe(at(10, 23, 20));
    await a.hear('change the meeting to monday at 9 am');
    expect((await only()).fixedStart).toBe(at(10, 26, 9));
  });

  it('"move dentist to 5pm" keeps the dentist on friday', async () => {
    const a = agent();
    await a.hear('dentist friday at 4pm');
    await a.hear('move dentist to 5pm');
    expect((await only()).fixedStart).toBe(at(10, 23, 17));
  });

  it('"from 5 to 6" when it is not at 5 gives the new range', async () => {
    const a = agent();
    await a.hear('meeting from 8 pm to 9 pm');
    await a.hear('change the meeting from 5 to 6');
    const t = await only();
    expect(t.fixedStart).toBe(at(10, 19, 17));
    expect(t.fixedEnd).toBe(at(10, 19, 18));
  });

  it('picks the meeting that is at the time you said', async () => {
    const a = agent();
    await a.hear('team meeting from 6 pm to 7 pm');
    await a.hear('client meeting from 9 am to 10 am');
    await a.hear('update the meeting from 6 pm to 7 pm');
    const byTitle = Object.fromEntries((await live()).map((t) => [t.title, t]));
    expect(byTitle['Team meeting'].fixedStart).toBe(at(10, 19, 19));
    expect(byTitle['Client meeting'].fixedStart).toBe(at(10, 20, 9));
  });

  it('asks which one when it can’t tell', async () => {
    const a = agent();
    await a.hear('team meeting from 6 pm to 7 pm');
    await a.hear('client meeting from 9 am to 10 am');
    const ask = await a.hear('change the meeting to 8 pm');
    expect(ask.options).toHaveLength(2);
    await a.hear('client');
    const byTitle = Object.fromEntries((await live()).map((t) => [t.title, t]));
    expect(byTitle['Client meeting'].fixedStart).toBe(at(10, 20, 20));
    expect(byTitle['Team meeting'].fixedStart).toBe(at(10, 19, 18));
  });

  it('renames and re-prioritises', async () => {
    const a = agent();
    await a.hear('gym at 6 pm');
    expect((await a.hear('rename gym to leg day')).say).toBe('Renamed "Gym" to "Leg day".');
    await a.hear('make it high priority');
    const t = await only();
    expect(t.title).toBe('Leg day');
    expect(t.priority).toBe('high');
  });

  it('turns a flexible task into an appointment', async () => {
    const a = agent();
    await a.hear('call mom tomorrow');
    await a.hear('change call mom to 8 pm');
    const t = await only();
    expect(t.fixedStart).toBeDefined();
    expect(t.title).toBe('Call mom');
  });

  it('undo puts the old time back', async () => {
    const a = agent();
    await a.hear('meeting from 6 pm to 7 pm');
    await a.hear('change meeting to 9 pm');
    expect((await only()).fixedStart).toBe(at(10, 19, 21));
    await a.hear('undo');
    expect((await only()).fixedStart).toBe(at(10, 19, 18));
  });

  it('says so, and adds nothing, when there is nothing to update', async () => {
    const a = agent();
    const turn = await a.hear('change the dentist to 5 pm');
    expect(turn.tone).toBe('error');
    expect(turn.say).toContain('find “dentist” to update');
    expect(await live()).toHaveLength(0);
  });

  it('still creates a task for "make dinner at 8" when there is no dinner yet', async () => {
    const a = agent();
    const turn = await a.hear('make dinner at 8 pm');
    expect(turn.tone).toBe('ok');
    expect((await only()).fixedStart).toBe(at(10, 19, 20));
  });
});

describe('the safety net', () => {
  it('turns a would-be duplicate into an edit when the sentence is an edit', async () => {
    const existing = makeTask({ title: 'Meeting', status: 'scheduled', fixedStart: at(10, 19, 18), fixedEnd: at(10, 19, 19) });
    const guessed = parseTasksOnly('change the meeting to 7 pm', CTX);
    // pretend a model answered with a new task "Meeting" at 19:00
    const tasks = [{ raw: 'x', title: 'Meeting', fixedStart: at(10, 19, 19), fixedEnd: at(10, 19, 20) }];
    expect(guessed.kind).toBe('tasks');
    expect(asUpdate(tasks, 'change the meeting to 7 pm', [existing], CTX)).toEqual({
      kind: 'update',
      target: 'Meeting',
      change: { startMin: 19 * 60 },
    });
  });

  it('leaves genuinely new tasks alone', () => {
    const existing = makeTask({ title: 'Meeting', status: 'scheduled', fixedStart: at(10, 19, 18), fixedEnd: at(10, 19, 19) });
    const tasks = [{ raw: 'x', title: 'Meeting', fixedStart: at(10, 19, 19), fixedEnd: at(10, 19, 20) }];
    expect(asUpdate(tasks, 'meeting at 7 pm', [existing], CTX)).toBeNull();
    expect(asUpdate([{ raw: 'x', title: 'Dentist', fixedStart: at(10, 19, 19), fixedEnd: at(10, 19, 20) }], 'change dentist to 7 pm', [existing], CTX)).toBeNull();
  });
});

describe('how sentences are read', () => {
  const kind = (s: string) => {
    const r = parseInput(s, CTX);
    return r.kind === 'command' ? r.command.kind : r.kind;
  };

  it('edits are commands, not new tasks', () => {
    for (const s of ['update the time of my meeting from 6 pm to 7 pm', 'change it to 7 pm', 'change the time to 7 pm', 'make it 30 minutes', 'rename gym to workout']) {
      expect(kind(s), s).toBe('update');
    }
  });

  it('plain statements and other commands are unchanged', () => {
    expect(kind('dentist is at 4pm')).toBe('tasks');
    expect(kind('mark gym as done')).toBe('finish');
    expect(kind('push gym to tomorrow')).toBe('push');
    expect(kind('delete call mom')).toBe('delete');
    expect(kind('change the oil tomorrow')).toBe('tasks'); // nothing says what to change it to: a new task
  });

  it('reads the new time, the old time and the day', () => {
    expect(parseCommand('update the time of my meeting from 6 pm to 7 pm', CTX)).toMatchObject({
      kind: 'update',
      target: 'meeting',
      change: { startMin: 19 * 60, fromMin: 18 * 60 },
    });
    expect(parseCommand('move the meeting to tomorrow at 8 pm', CTX)).toMatchObject({ kind: 'push' });
    expect(parseCommand('change the time to 7 pm', CTX)).toMatchObject({ kind: 'update', target: '' });
  });
});

describe('applyChange', () => {
  const meeting = makeTask({ title: 'Meeting', status: 'scheduled', fixedStart: at(10, 19, 18), fixedEnd: at(10, 19, 19) });

  it('moves the start and keeps the length', () => {
    const r = applyChange(meeting, { startMin: 20 * 60 }, TZ, NOW);
    expect(r.changes).toMatchObject({ fixedStart: at(10, 19, 20), fixedEnd: at(10, 19, 21), estimateMin: 60, blocks: [] });
    expect(r.rescheduled).toBe(true);
  });

  it('handles a range that crosses midnight', () => {
    const r = applyChange(meeting, { startMin: 22 * 60, endMin: 2 * 60 }, TZ, NOW);
    expect(r.changes.fixedEnd).toBe(at(10, 20, 2));
  });

  it('changing only the end leaves the start alone', () => {
    const r = applyChange(meeting, { endMin: 18 * 60 + 30 }, TZ, NOW);
    expect(r.changes).toMatchObject({ fixedEnd: at(10, 19, 18, 30), estimateMin: 30 });
    expect(r.changes.fixedStart).toBeUndefined();
  });

  it('changes nothing it was not asked to', () => {
    expect(applyChange(meeting, { priority: 'high' }, TZ, NOW).changes).toEqual({ priority: 'high' });
  });
});

describe('Gemini edits', () => {
  it('turns an update answer into the same command', () => {
    const r = toParseResult({ intent: 'command', command: { action: 'update', target: 'meeting', time: '19:00', fromTime: '18:00' } }, CTX, 'x');
    expect(r).toMatchObject({ kind: 'command', command: { kind: 'update', target: 'meeting', change: { startMin: 1140, fromMin: 1080 } } });
  });

  it('accepts "this" with no target, and ignores an update that changes nothing', () => {
    expect(toParseResult({ intent: 'command', command: { action: 'update', target: 'this', minutes: 30 } }, CTX, 'x')).toMatchObject({
      command: { kind: 'update', target: 'this', change: { durationMin: 30 } },
    });
    expect(toParseResult({ intent: 'command', command: { action: 'update', target: 'meeting' } }, CTX, 'x').kind).toBe('empty');
  });

  it('corrects a model that got am/pm wrong on an edit', () => {
    expect(applySpokenChange({ startMin: 7 * 60 }, 'change the meeting to 7 pm')).toEqual({ startMin: 19 * 60 });
    expect(applySpokenChange({ startMin: 19 * 60, endMin: 20 * 60 }, 'update meeting to 7 to 7:30 pm')).toEqual({ startMin: 19 * 60, endMin: 19 * 60 + 30 });
    expect(applySpokenChange({ startMin: 19 * 60, fromMin: 18 * 60 }, 'change meeting from 6 pm to 7 pm')).toEqual({ startMin: 19 * 60, fromMin: 18 * 60 });
  });
});
