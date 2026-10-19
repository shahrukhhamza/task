import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const ALICE = '11111111-1111-1111-1111-111111111111';
const BOB = '22222222-2222-2222-2222-222222222222';

let pg: PGlite;

/** Runs SQL as a signed-in user, the way Supabase does (role + JWT claim). */
async function asUser<T>(user: string, fn: () => Promise<T>): Promise<T> {
  await pg.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${user}', false);`);
  try {
    return await fn();
  } finally {
    await pg.exec('reset role;');
  }
}

beforeAll(async () => {
  pg = new PGlite();
  // the bits of Supabase the migration relies on
  await pg.exec(`
    create schema auth;
    create table auth.users (id uuid primary key, email text);
    create function auth.uid() returns uuid language sql stable
      as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create role authenticated nologin;
    grant usage on schema public, auth to authenticated;
    grant execute on function auth.uid() to authenticated;
  `);
  await pg.exec(readFileSync('supabase/migrations/0001_init.sql', 'utf8'));
  await pg.exec(readFileSync('supabase/migrations/0003_push_prefs.sql', 'utf8'));
  // Supabase grants table access to authenticated by default; RLS does the restricting
  await pg.exec('grant all on all tables in schema public to authenticated;');
  await pg.exec(`insert into auth.users values ('${ALICE}', 'alice@example.com'), ('${BOB}', 'bob@example.com');`);
}, 120_000); // the embedded Postgres takes a while to boot

afterAll(async () => {
  await pg.close();
});

describe('sign-up', () => {
  it('creates a profile with defaults and the account email', async () => {
    const { rows } = await pg.query<{ timezone: string; email_recipient: string; updated_at: string }>(
      `select timezone, email_recipient, updated_at from public.profiles where id = '${ALICE}'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].timezone).toBe('Asia/Karachi');
    expect(rows[0].email_recipient).toBe('alice@example.com');
    // epoch, so settings changed on a device win over these defaults on first sync
    expect(new Date(rows[0].updated_at).getTime()).toBe(0);
  });
});

describe('push preferences', () => {
  it('start on, at sensible times', async () => {
    const { rows } = await pg.query(
      `select push_morning, push_morning_time, push_deadlines, push_evening, push_evening_time from public.profiles where id = '${ALICE}'`,
    );
    expect(rows).toEqual([{ push_morning: true, push_morning_time: '08:00', push_deadlines: true, push_evening: true, push_evening_time: '20:30' }]);
  });

  it('reject a time that is not HH:MM', async () => {
    await expect(pg.exec(`update public.profiles set push_morning_time = '8am' where id = '${ALICE}'`)).rejects.toThrow();
  });
});

describe('row level security', () => {
  it('lets a user write and read their own rows', async () => {
    await asUser(ALICE, async () => {
      await pg.exec(`insert into public.tasks (id, title) values ('a1', 'Alice task')`);
      const { rows } = await pg.query(`select id from public.tasks`);
      expect(rows).toEqual([{ id: 'a1' }]);
    });
  });

  it('hides other users’ rows', async () => {
    await asUser(BOB, async () => {
      const { rows } = await pg.query(`select id from public.tasks`);
      expect(rows).toEqual([]);
    });
  });

  it('cannot update or delete other users’ rows', async () => {
    await asUser(BOB, async () => {
      const upd = await pg.query(`update public.tasks set title = 'hacked' where id = 'a1' returning id`);
      const del = await pg.query(`delete from public.tasks where id = 'a1' returning id`);
      expect(upd.rows).toHaveLength(0);
      expect(del.rows).toHaveLength(0);
    });
    const { rows } = await pg.query<{ title: string }>(`select title from public.tasks where id = 'a1'`);
    expect(rows[0].title).toBe('Alice task');
  });

  it('cannot insert a row owned by someone else', async () => {
    await asUser(BOB, async () => {
      await expect(
        pg.exec(`insert into public.tasks (user_id, id, title) values ('${ALICE}', 'evil', 'x')`),
      ).rejects.toThrow(/row-level security/);
    });
  });

  it('cannot reassign a row to another user', async () => {
    await asUser(ALICE, async () => {
      await expect(pg.exec(`update public.tasks set user_id = '${BOB}' where id = 'a1'`)).rejects.toThrow(
        /row-level security/,
      );
    });
  });

  it('protects every user table, not just tasks', async () => {
    const tables = [
      ['task_events', `(id, task_id, type, at) values ('e1', 'a1', 'created', now())`],
      ['fixed_events', `(id, title, start_at, end_at) values ('f1', 'Class', now(), now())`],
      ['habits', `(id, title) values ('h1', 'Read')`],
      ['habit_logs', `(id, habit_id, date) values ('h1:2026-10-19', 'h1', '2026-10-19')`],
      ['checkins', `(id, date, mood, energy) values ('2026-10-19', '2026-10-19', 4, 3)`],
      ['calendar_links', `(id, task_id, event_id) values ('a1', 'a1', 'evt')`],
    ] as const;

    for (const [table, values] of tables) {
      await asUser(ALICE, () => pg.exec(`insert into public.${table} ${values}`));
      const mine = await asUser(ALICE, () => pg.query(`select 1 from public.${table}`));
      const theirs = await asUser(BOB, () => pg.query(`select 1 from public.${table}`));
      expect(mine.rows, `${table} visible to owner`).toHaveLength(1);
      expect(theirs.rows, `${table} hidden from others`).toHaveLength(0);
    }
  });

  it('keeps profiles private', async () => {
    await asUser(BOB, async () => {
      const { rows } = await pg.query<{ id: string }>(`select id from public.profiles`);
      expect(rows.map((r) => r.id)).toEqual([BOB]);
    });
  });
});

describe('server-only tables', () => {
  it('hides google refresh tokens from signed-in users', async () => {
    await pg.exec(`insert into public.google_tokens (user_id, refresh_token) values ('${ALICE}', 'secret')`);
    await asUser(ALICE, async () => {
      const { rows } = await pg.query(`select * from public.google_tokens`);
      expect(rows).toHaveLength(0);
      await expect(
        pg.exec(`insert into public.google_tokens (user_id, refresh_token) values ('${ALICE}', 'mine')`),
      ).rejects.toThrow(/row-level security/);
    });
  });

  it('lets users read their email log but not forge entries', async () => {
    await pg.exec(
      `insert into public.email_logs (user_id, kind, for_date, status) values ('${ALICE}', 'daily', '2026-10-19', 'sent')`,
    );
    await asUser(ALICE, async () => {
      const { rows } = await pg.query(`select kind from public.email_logs`);
      expect(rows).toHaveLength(1);
      await expect(
        pg.exec(`insert into public.email_logs (user_id, kind, for_date, status) values ('${ALICE}', 'daily', '2026-10-20', 'sent')`),
      ).rejects.toThrow(/row-level security/);
    });
    await asUser(BOB, async () => {
      expect((await pg.query(`select * from public.email_logs`)).rows).toHaveLength(0);
    });
  });

  it('prevents sending the same daily summary twice but allows retries and tests', async () => {
    await expect(
      pg.exec(`insert into public.email_logs (user_id, kind, for_date, status) values ('${ALICE}', 'daily', '2026-10-19', 'sent')`),
    ).rejects.toThrow(/duplicate key/);
    await pg.exec(`insert into public.email_logs (user_id, kind, for_date, status) values ('${ALICE}', 'daily', '2026-10-19', 'failed')`);
    await pg.exec(`insert into public.email_logs (user_id, kind, for_date, status) values ('${ALICE}', 'test', '2026-10-19', 'sent')`);
    await pg.exec(`insert into public.email_logs (user_id, kind, for_date, status) values ('${ALICE}', 'test', '2026-10-19', 'sent')`);
  });

  it('lets users register but not read push subscriptions', async () => {
    await asUser(ALICE, async () => {
      await pg.exec(`insert into public.push_subscriptions (endpoint, p256dh, auth) values ('https://push/1', 'k', 'a')`);
      expect((await pg.query(`select * from public.push_subscriptions`)).rows).toHaveLength(0);
    });
  });
});

describe('last write wins', () => {
  it('ignores a write that is older than what the server has', async () => {
    await asUser(ALICE, async () => {
      await pg.exec(`insert into public.tasks (id, title, updated_at) values ('lww', 'v2', '2026-10-19T10:00:00Z')`);
      await pg.exec(`
        insert into public.tasks (id, title, updated_at) values ('lww', 'stale', '2026-10-19T09:00:00Z')
        on conflict (user_id, id) do update set title = excluded.title, updated_at = excluded.updated_at`);
      const { rows } = await pg.query<{ title: string }>(`select title from public.tasks where id = 'lww'`);
      expect(rows[0].title).toBe('v2');
    });
  });

  it('stamps synced_at with the server clock even for offline edits with old timestamps', async () => {
    await asUser(ALICE, async () => {
      await pg.exec(`insert into public.tasks (id, title, updated_at) values ('old', 'made offline', '2020-01-01T00:00:00Z')`);
      const { rows } = await pg.query<{ synced_at: string }>(`select synced_at from public.tasks where id = 'old'`);
      expect(Date.now() - new Date(rows[0].synced_at).getTime()).toBeLessThan(60_000);
    });
  });

  it('does not move synced_at when a stale write is dropped', async () => {
    await asUser(ALICE, async () => {
      const before = (await pg.query<{ synced_at: string }>(`select synced_at from public.tasks where id = 'lww'`)).rows[0].synced_at;
      await pg.exec(`
        insert into public.tasks (id, title, updated_at) values ('lww', 'stale again', '2026-10-19T08:00:00Z')
        on conflict (user_id, id) do update set title = excluded.title, updated_at = excluded.updated_at`);
      const after = (await pg.query<{ synced_at: string }>(`select synced_at from public.tasks where id = 'lww'`)).rows[0].synced_at;
      expect(after).toEqual(before);
    });
  });

  it('applies a newer write', async () => {
    await asUser(ALICE, async () => {
      await pg.exec(`
        insert into public.tasks (id, title, updated_at) values ('lww', 'v3', '2026-10-19T11:00:00Z')
        on conflict (user_id, id) do update set title = excluded.title, updated_at = excluded.updated_at`);
      const { rows } = await pg.query<{ title: string }>(`select title from public.tasks where id = 'lww'`);
      expect(rows[0].title).toBe('v3');
    });
  });
});

describe('constraints', () => {
  it('rejects invalid values', async () => {
    await asUser(ALICE, async () => {
      await expect(pg.exec(`insert into public.tasks (id, title, priority) values ('p', 'x', 'urgent')`)).rejects.toThrow(/check constraint/);
      await expect(pg.exec(`insert into public.tasks (id, title, status) values ('s', 'x', 'nope')`)).rejects.toThrow(/check constraint/);
      await expect(pg.exec(`insert into public.checkins (id, date, mood, energy) values ('c2', '2026-10-20', 6, 3)`)).rejects.toThrow(/check constraint/);
    });
  });

  it('allows only one check-in per day', async () => {
    await asUser(ALICE, async () => {
      await expect(
        pg.exec(`insert into public.checkins (id, date, mood, energy) values ('another', '2026-10-19', 3, 3)`),
      ).rejects.toThrow(/duplicate key/);
    });
  });
});
