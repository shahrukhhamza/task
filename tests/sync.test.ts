import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { DayflowDB } from '../src/lib/db/schema';
import { pendingCount, syncOnce } from '../src/lib/sync/engine';
import { shouldApplyRemote, taskMapper } from '../src/lib/sync/mappers';
import { DEFAULT_PROFILE, type Task } from '../src/lib/types';
import { MemoryRemote } from './fakeRemote';
import { NOW, makeTask } from './helpers';

const USER = 'user-1';
const dbs: DayflowDB[] = [];
const device = () => {
  const d = new DayflowDB(`test-${Math.random()}`);
  dbs.push(d);
  return d;
};

afterEach(async () => {
  for (const d of dbs.splice(0)) await d.delete();
});

const dirtyTask = (over: Partial<Task> = {}) => makeTask({ syncState: 'dirty', ...over });

describe('conflict rule', () => {
  it('takes remote rows for missing or clean local rows', () => {
    expect(shouldApplyRemote(undefined, 5)).toBe(true);
    expect(shouldApplyRemote({ updatedAt: 5, dirty: false }, 5)).toBe(true);
    expect(shouldApplyRemote({ updatedAt: 9, dirty: false }, 5)).toBe(false);
  });

  it('keeps unsynced local edits unless the remote is newer', () => {
    expect(shouldApplyRemote({ updatedAt: 10, dirty: true }, 5)).toBe(false);
    expect(shouldApplyRemote({ updatedAt: 10, dirty: true }, 10)).toBe(false);
    expect(shouldApplyRemote({ updatedAt: 10, dirty: true }, 11)).toBe(true);
  });
});

describe('mappers', () => {
  it('round-trips a task through a database row', () => {
    const task = makeTask({
      id: 'x',
      dueAt: NOW + 1000,
      fixedStart: undefined,
      recurrence: { freq: 'weekly', interval: 1, byDay: [1, 3] },
      blocks: [{ id: 'b', taskId: 'x', start: NOW, end: NOW + 60_000, chunk: 1, chunks: 1 }],
      deletedAt: null,
      syncState: 'dirty',
    });
    const row = taskMapper.toRow(task, USER);
    expect(row).toMatchObject({ user_id: USER, id: 'x', due_at: new Date(NOW + 1000).toISOString(), fixed_start: null });
    const back = taskMapper.fromRow(JSON.parse(JSON.stringify(row)));
    expect(back).toEqual({ ...task, syncState: 'synced', addToCalendar: undefined, calendarEventId: undefined, notes: undefined });
  });
});

describe('two devices', () => {
  it('uploads local changes and marks them synced', async () => {
    const a = device();
    const remote = new MemoryRemote();
    await a.tasks.bulkPut([dirtyTask({ id: 't1', title: 'One' }), dirtyTask({ id: 't2', title: 'Two' })]);
    expect(await pendingCount(a)).toBe(2);

    const result = await syncOnce(a, remote, USER);
    expect(result.pushed).toBe(2);
    expect(remote.rows('tasks').map((r) => r.title).sort()).toEqual(['One', 'Two']);
    expect(await pendingCount(a)).toBe(0);
  });

  it('downloads everything onto a new device', async () => {
    const a = device();
    const b = device();
    const remote = new MemoryRemote();
    await a.tasks.put(dirtyTask({ id: 't1', title: 'From A' }));
    await a.taskEvents.add({ id: 'e1', taskId: 't1', type: 'created', at: NOW });
    await a.checkins.put({ id: '2026-10-19', date: '2026-10-19', mood: 4, energy: 3, createdAt: NOW, updatedAt: NOW, syncState: 'dirty' });
    await syncOnce(a, remote, USER);

    await syncOnce(b, remote, USER);
    expect((await b.tasks.get('t1'))?.title).toBe('From A');
    expect((await b.taskEvents.get('e1'))?.type).toBe('created');
    expect((await b.checkins.get('2026-10-19'))?.mood).toBe(4);
    expect(await pendingCount(b)).toBe(0);
  });

  it('resolves concurrent edits with the newest write on both devices', async () => {
    const a = device();
    const b = device();
    const remote = new MemoryRemote();
    await a.tasks.put(dirtyTask({ id: 't', title: 'Original', updatedAt: NOW }));
    await syncOnce(a, remote, USER);
    await syncOnce(b, remote, USER);

    await a.tasks.update('t', { title: 'Edited on A', updatedAt: NOW + 10, syncState: 'dirty' });
    await b.tasks.update('t', { title: 'Edited on B later', updatedAt: NOW + 20, syncState: 'dirty' });

    await syncOnce(a, remote, USER);
    await syncOnce(b, remote, USER);
    await syncOnce(a, remote, USER);

    expect((await a.tasks.get('t'))?.title).toBe('Edited on B later');
    expect((await b.tasks.get('t'))?.title).toBe('Edited on B later');
    expect(remote.rows('tasks')[0].title).toBe('Edited on B later');
  });

  it('keeps the newer local edit when the server copy is older', async () => {
    const a = device();
    const b = device();
    const remote = new MemoryRemote();
    await a.tasks.put(dirtyTask({ id: 't', title: 'v1', updatedAt: NOW }));
    await syncOnce(a, remote, USER);
    await syncOnce(b, remote, USER);

    // B edits later but syncs first; A's older edit must not overwrite it
    await b.tasks.update('t', { title: 'B newer', updatedAt: NOW + 50, syncState: 'dirty' });
    await a.tasks.update('t', { title: 'A older', updatedAt: NOW + 5, syncState: 'dirty' });
    await syncOnce(b, remote, USER);
    await syncOnce(a, remote, USER);

    expect((await a.tasks.get('t'))?.title).toBe('B newer');
    expect(remote.rows('tasks')[0].title).toBe('B newer');
  });

  it('still delivers an offline edit whose timestamp is older than the other device’s cursor', async () => {
    const a = device();
    const b = device();
    const remote = new MemoryRemote();
    await a.tasks.put(dirtyTask({ id: 'new', title: 'Written offline long ago', updatedAt: NOW - 86_400_000 }));
    await b.tasks.put(dirtyTask({ id: 'other', updatedAt: NOW }));
    await syncOnce(b, remote, USER); // B's cursor moves forward first

    await syncOnce(a, remote, USER); // A comes back online with an "old" row
    await syncOnce(b, remote, USER);
    expect((await b.tasks.get('new'))?.title).toBe('Written offline long ago');
  });

  it('propagates deletes as tombstones', async () => {
    const a = device();
    const b = device();
    const remote = new MemoryRemote();
    await a.tasks.put(dirtyTask({ id: 't', updatedAt: NOW }));
    await syncOnce(a, remote, USER);
    await syncOnce(b, remote, USER);

    await a.tasks.update('t', { deletedAt: NOW + 1, updatedAt: NOW + 1, syncState: 'dirty' });
    await syncOnce(a, remote, USER);
    await syncOnce(b, remote, USER);
    expect((await b.tasks.get('t'))?.deletedAt).toBe(NOW + 1);
  });

  it('retries after a failed upload without losing anything', async () => {
    const a = device();
    const remote = new MemoryRemote();
    await a.tasks.put(dirtyTask({ id: 't' }));
    remote.failNextPush = true;
    await expect(syncOnce(a, remote, USER)).rejects.toThrow('network down');
    expect(await pendingCount(a)).toBe(1);
    await syncOnce(a, remote, USER);
    expect(await pendingCount(a)).toBe(0);
    expect(remote.rows('tasks')).toHaveLength(1);
  });

  it('does not mark a row synced if it changed while uploading', async () => {
    const a = device();
    const remote = new MemoryRemote();
    await a.tasks.put(dirtyTask({ id: 't', title: 'first', updatedAt: NOW }));
    const originalPush = remote.push.bind(remote);
    remote.push = async (table, rows, key) => {
      await originalPush(table, rows, key);
      if (table === 'tasks') await a.tasks.update('t', { title: 'second', updatedAt: NOW + 1, syncState: 'dirty' });
    };
    await syncOnce(a, remote, USER);
    expect((await a.tasks.get('t'))?.syncState).toBe('dirty');
  });
});

describe('profile', () => {
  it('maps the local "me" profile to the user id and back', async () => {
    const a = device();
    const b = device();
    const remote = new MemoryRemote();
    await a.profile.put({ ...DEFAULT_PROFILE, timezone: 'Europe/London', updatedAt: NOW, syncState: 'dirty' });
    await syncOnce(a, remote, USER);
    expect(remote.rows('profiles')[0]).toMatchObject({ id: USER, timezone: 'Europe/London' });

    await b.profile.put(DEFAULT_PROFILE);
    await syncOnce(b, remote, USER);
    expect((await b.profile.get('me'))?.timezone).toBe('Europe/London');
  });

  it('never uploads an untouched default profile over the server copy', async () => {
    const a = device();
    const remote = new MemoryRemote();
    await remote.serverWrite('profiles', { id: USER, email_recipient: 'me@example.com', timezone: 'Asia/Karachi', updated_at: new Date(0).toISOString() }, 'id');
    await a.profile.put(DEFAULT_PROFILE);
    await syncOnce(a, remote, USER);
    expect(remote.rows('profiles')[0].email_recipient).toBe('me@example.com');
    expect((await a.profile.get('me'))?.emailRecipient).toBe('me@example.com');
  });
});
