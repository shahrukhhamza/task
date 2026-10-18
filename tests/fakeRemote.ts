import type { Remote } from '../src/lib/sync/engine';
import type { Row } from '../src/lib/sync/mappers';

/**
 * Behaves like the Postgres schema for sync purposes: upserts by key, drops writes
 * older than the stored row, and stamps synced_at with its own monotonic clock.
 */
export class MemoryRemote implements Remote {
  tables = new Map<string, Map<string, Row>>();
  private clock = Date.UTC(2030, 0, 1);
  pulls = 0;
  failNextPush = false;

  private table(name: string) {
    let t = this.tables.get(name);
    if (!t) this.tables.set(name, (t = new Map()));
    return t;
  }

  rows(name: string): Row[] {
    return [...this.table(name).values()];
  }

  async pull(name: string, since: string | null): Promise<Row[]> {
    this.pulls++;
    const from = since ? new Date(since).getTime() - 60_000 : -Infinity;
    return this.rows(name)
      .filter((r) => new Date(r.synced_at as string).getTime() > from)
      .sort((a, b) => new Date(a.synced_at as string).getTime() - new Date(b.synced_at as string).getTime())
      .map((r) => structuredClone(r));
  }

  async push(name: string, rows: Row[], conflictKey: string): Promise<void> {
    if (this.failNextPush) {
      this.failNextPush = false;
      throw new Error('network down');
    }
    const t = this.table(name);
    for (const row of rows) {
      const key = conflictKey.split(',').map((c) => row[c]).join('|');
      const existing = t.get(key);
      if (existing && new Date(row.updated_at as string) < new Date(existing.updated_at as string)) continue;
      this.clock += 1000;
      t.set(key, { ...existing, ...structuredClone(row), synced_at: new Date(this.clock).toISOString() });
    }
  }

  /** Simulates another device writing directly to the server. */
  async serverWrite(name: string, row: Row, conflictKey = 'user_id,id') {
    await this.push(name, [row], conflictKey);
  }
}
