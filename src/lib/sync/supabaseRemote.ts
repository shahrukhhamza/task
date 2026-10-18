import type { SupabaseClient } from '@supabase/supabase-js';
import type { Remote } from './engine';
import type { Row } from './mappers';

const PAGE = 1000;
/** Re-read a little before the cursor so rows committed slightly out of order aren't missed. */
const OVERLAP_MS = 60_000;

export function supabaseRemote(client: SupabaseClient): Remote {
  return {
    async pull(table, since) {
      const from = since ? new Date(new Date(since).getTime() - OVERLAP_MS).toISOString() : null;
      const rows: Row[] = [];
      for (let page = 0; ; page++) {
        let query = client
          .from(table)
          .select('*')
          .order('synced_at', { ascending: true })
          .order('id', { ascending: true })
          .range(page * PAGE, page * PAGE + PAGE - 1);
        if (from) query = query.gt('synced_at', from);
        const { data, error } = await query;
        if (error) throw new Error(`${table}: ${error.message}`);
        rows.push(...(data as Row[]));
        if (!data || data.length < PAGE) break;
      }
      return rows;
    },

    async push(table, rows, conflictKey) {
      const { error } = await client.from(table).upsert(rows, { onConflict: conflictKey });
      if (error) throw new Error(`${table}: ${error.message}`);
    },
  };
}
