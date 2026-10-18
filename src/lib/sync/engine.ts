import type { Table } from 'dexie';
import type { DayflowDB } from '../db/schema';
import { MAPPERS, shouldApplyRemote, type Row, type TableMapper } from './mappers';

/** What the sync engine needs from the server. The Supabase implementation lives in ./supabaseRemote. */
export interface Remote {
  /**
   * Rows the server accepted after `since` (an ISO `synced_at`), oldest first. Implementations
   * should overlap the window slightly; re-applying a row is harmless.
   */
  pull(table: string, since: string | null): Promise<Row[]>;
  /** Insert or update by primary key. */
  push(table: string, rows: Row[], conflictKey: string): Promise<void>;
}

export interface SyncResult {
  pulled: number;
  pushed: number;
}

const PUSH_BATCH = 500;

const idOf = (mapper: TableMapper<unknown>, row: Row) => (mapper.local === 'profile' ? 'me' : (row.id as string));

/**
 * One round of two-way sync for every table: pull what changed on the server,
 * merge it with last-write-wins, then push local edits.
 */
export async function syncOnce(db: DayflowDB, remote: Remote, userId: string): Promise<SyncResult> {
  let pulled = 0;
  let pushed = 0;

  for (const mapper of MAPPERS as readonly TableMapper<any>[]) {
    const table = db.table(mapper.local) as Table<any, string>;
    const cursorKey = `pulled:${mapper.remote}:${userId}`;

    // ---- pull
    const since = (await db.syncMeta.get(cursorKey))?.value ?? null;
    const rows = await remote.pull(mapper.remote, since);
    if (rows.length) {
      let cursor = since;
      await db.transaction('rw', table, async () => {
        for (const row of rows) {
          const incoming = mapper.fromRow(row);
          const local = await table.get(idOf(mapper, row));
          const decision = shouldApplyRemote(
            local && { updatedAt: mapper.updatedAt(local), dirty: mapper.isDirty(local) },
            mapper.updatedAt(incoming),
          );
          // the pull window overlaps, so skip rows we already have exactly
          if (decision && JSON.stringify(local) !== JSON.stringify(incoming)) {
            await table.put(incoming);
            pulled++;
          }
          // the cursor follows the server's clock (synced_at), never the device's
          const stamp = row.synced_at as string;
          if (stamp && (!cursor || new Date(stamp) > new Date(cursor))) cursor = stamp;
        }
      });
      if (cursor) await db.syncMeta.put({ key: cursorKey, value: cursor });
    }

    // ---- push
    const pending = (await table.toArray()).filter((item) => mapper.isDirty(item));
    for (let i = 0; i < pending.length; i += PUSH_BATCH) {
      const batch = pending.slice(i, i + PUSH_BATCH);
      await remote.push(mapper.remote, batch.map((item) => mapper.toRow(item, userId)), mapper.conflictKey);

      // only mark rows synced if nobody edited them while the request was in flight
      await db.transaction('rw', table, async () => {
        for (const sent of batch) {
          const key = sent.id as string;
          const current = await table.get(key);
          if (current && mapper.updatedAt(current) === mapper.updatedAt(sent)) {
            await table.update(key, { syncState: 'synced' });
          }
        }
      });
      pushed += batch.length;
    }
  }

  return { pulled, pushed };
}

/** Number of local rows waiting to be uploaded. */
export async function pendingCount(db: DayflowDB): Promise<number> {
  let count = 0;
  for (const mapper of MAPPERS as readonly TableMapper<any>[]) {
    const table = db.table(mapper.local) as Table<any, string>;
    count += (await table.toArray()).filter((item) => mapper.isDirty(item)).length;
  }
  return count;
}
