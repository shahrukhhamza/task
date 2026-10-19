import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { clearAllData } from '../src/lib/db/actions';
import { db } from '../src/lib/db/schema';
import { parseInput } from '../src/lib/parser';
import { createVoiceAgent } from '../src/lib/voice/agent';
import { NOW, TZ, at } from './helpers';

// Rules-only "model", so the tests are deterministic and offline
const agent = () => createVoiceAgent({ understand: async (text, ctx) => parseInput(text, ctx), smart: false, now: () => NOW });
const live = async () => (await db.tasks.toArray()).filter((t) => !t.deletedAt);

beforeEach(async () => {
  await clearAllData();
  await db.profile.put({ ...(await db.profile.get('me')), id: 'me', timezone: TZ } as never);
});

describe('voice agent: adding', () => {
  it('"add a meeting from 5 pm to 6 pm" creates the task and says when it is', async () => {
    const turn = await agent().hear('add a meeting from 5 pm to 6 pm');
    expect(turn.tone).toBe('ok');
    expect(turn.say).toBe('Added “Meeting”, today from 5:00 PM to 6:00 PM.');
    const [task] = await live();
    expect(task.title).toBe('Meeting');
    expect(task.fixedStart).toBe(at(10, 19, 17));
    expect(task.fixedEnd).toBe(at(10, 19, 18));
  });

  it('"8 AM to 9PM" is a thirteen hour block, and the answer says so', async () => {
    const turn = await agent().hear('I have a meeting from 8 AM to 9PM tomorrow');
    expect(turn.say).toBe('Added “Meeting”, tomorrow from 8:00 AM to 9:00 PM.');
    const [task] = await live();
    expect(task.fixedEnd! - task.fixedStart!).toBe(13 * 3_600_000);
  });

  it('adds several tasks from one sentence', async () => {
    const turn = await agent().hear('gym at 6pm, call mom');
    expect(turn.say).toContain('Added 2 tasks');
    expect(await live()).toHaveLength(2);
  });

  it('warns when a new appointment overlaps an existing one', async () => {
    const a = agent();
    await a.hear('dentist from 4 pm to 5 pm');
    const turn = await a.hear('call from 4:30 pm to 5:30 pm');
    expect(turn.say).toContain('overlaps “Dentist”');
  });

  it('does nothing for an empty sentence', async () => {
    expect((await agent().hear('   ')).say).toBe('');
    expect(await live()).toHaveLength(0);
  });
});

describe('voice agent: removing and changing', () => {
  it('"remove this" deletes the task that was just added', async () => {
    const a = agent();
    await a.hear('add a meeting from 5 pm to 6 pm');
    await a.hear('add gym at 7 pm');
    const turn = await a.hear('remove this');
    expect(turn.say).toBe('Deleted "Gym".');
    expect((await live()).map((t) => t.title)).toEqual(['Meeting']);
  });

  it.each(['delete it', 'cancel that one', 'remove this meeting'])('"%s" points at the task in play', async (phrase) => {
    const a = agent();
    await a.hear('add a meeting from 5 pm to 6 pm');
    await a.hear(phrase);
    expect(await live()).toHaveLength(0);
  });

  it('asks which task when "this" has nothing to point at', async () => {
    const turn = await agent().hear('remove this');
    expect(turn.tone).toBe('error');
    expect(turn.say).toBe('Which task do you mean? Tell me its name.');
  });

  it('removes a task by name', async () => {
    const a = agent();
    await a.hear('dentist at 4pm');
    await a.hear('call mom tomorrow');
    await a.hear('remove the dentist');
    expect((await live()).map((t) => t.title)).toEqual(['Call mom']);
  });

  it('"it" follows the last thing touched', async () => {
    const a = agent();
    await a.hear('add gym at 7 pm');
    await a.hear('add reading tomorrow');
    await a.hear('mark gym as done');
    await a.hear('delete it');
    const titles = (await live()).map((t) => t.title);
    expect(titles).not.toContain('Gym');
    expect(titles).toContain('Reading');
  });

  it('moves a task', async () => {
    const a = agent();
    await a.hear('gym at 6pm');
    const turn = await a.hear('move it to tomorrow at 7pm');
    expect(turn.tone).toBe('ok');
    const [gym] = await live();
    expect(gym.fixedStart).toBe(at(10, 20, 19));
  });
});

describe('voice agent: undo, choices and stopping', () => {
  it('undo brings back a deleted task and takes back an added one', async () => {
    const a = agent();
    await a.hear('add gym at 7 pm');
    await a.hear('remove this');
    expect(await live()).toHaveLength(0);
    expect((await a.hear('undo')).say).toBe('Done, I’ve put it back.');
    expect(await live()).toHaveLength(1);
    await a.hear('remove this');
    await a.hear('never mind');
    expect(await live()).toHaveLength(1);
    expect((await a.hear('undo')).say).toBe('There’s nothing to undo yet.');
  });

  it('asks when two tasks match and understands "the second one"', async () => {
    const a = agent();
    await a.hear('call mom tomorrow');
    await a.hear('call dentist tomorrow');
    const ask = await a.hear('delete call');
    expect(ask.options).toHaveLength(2);
    expect(ask.say).toMatch(/^Which one do you want to delete\?/);
    expect(a.context.hasPending).toBe(true);
    await a.hear('the second one');
    expect(await live()).toHaveLength(1);
    expect(a.context.hasPending).toBe(false);
  });

  it('an answer by name works too, and an unrelated sentence drops the question', async () => {
    const a = agent();
    await a.hear('call mom tomorrow');
    await a.hear('call dentist tomorrow');
    await a.hear('delete call');
    await a.hear('mom');
    expect((await live()).map((t) => t.title)).toEqual(['Call dentist']);

    await a.hear('call sara tomorrow');
    await a.hear('delete call');
    await a.hear('buy milk tomorrow');
    expect(a.context.hasPending).toBe(false);
    expect((await live()).map((t) => t.title)).toContain('Buy milk');
  });

  it('stops when told to', async () => {
    expect((await agent().hear('stop listening')).end).toBe(true);
    expect((await agent().hear("that's all")).end).toBe(true);
  });
});

describe('voice agent: asking about the day', () => {
  it('reads out what is coming up', async () => {
    const a = agent();
    await a.hear('dentist at 4pm');
    await a.hear('gym at 6pm');
    const turn = await a.hear("what's on my schedule today");
    expect(turn.say).toBe('Today you have Dentist at 4:00 PM and Gym at 6:00 PM.');
  });

  it('says so when the day is empty', async () => {
    expect((await agent().hear('what do I have tomorrow')).say).toBe('Nothing is planned for tomorrow yet.');
  });
});

describe('voice agent: model errors', () => {
  it('turns a failing model into an error turn instead of throwing', async () => {
    const broken = createVoiceAgent({
      understand: async () => {
        throw new Error('offline');
      },
      smart: true,
      now: () => NOW,
    });
    const turn = await broken.hear('write the report by friday');
    expect(turn.tone).toBe('error');
    expect(turn.say).toContain('offline');
  });
});
