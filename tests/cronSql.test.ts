import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

let pg: PGlite;

beforeAll(async () => {
  pg = new PGlite();
  // stand-ins for Supabase's pg_cron, pg_net and Vault with the same call signatures
  await pg.exec(`
    create role anon nologin; create role authenticated nologin;
    create schema cron;
    create table cron.job (jobname text primary key, schedule text, command text);
    create function cron.schedule(job_name text, schedule text, command text) returns bigint language sql as $$
      insert into cron.job values (job_name, schedule, command)
      on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command;
      select 1::bigint;
    $$;
    create schema net;
    create table net._http_response (id serial, created timestamptz default now());
    create table net.calls (url text, headers jsonb, body jsonb, timeout int);
    create function net.http_post(url text, body jsonb default '{}', params jsonb default '{}', headers jsonb default '{}', timeout_milliseconds int default 5000)
      returns bigint language sql as $$ insert into net.calls values (url, headers, body, timeout_milliseconds); select 1::bigint; $$;
    create schema vault;
    create table vault.decrypted_secrets (name text primary key, decrypted_secret text);
    insert into vault.decrypted_secrets values ('project_url', 'https://abc.supabase.co'), ('cron_secret', 'shh');
  `);
  // the real extensions don't exist here; everything else runs as written
  const sql = readFileSync('supabase/migrations/0002_cron.sql', 'utf8').replace(/^create extension.*$/gm, '');
  await pg.exec(sql);
}, 120_000);

afterAll(async () => {
  await pg.close();
});

describe('cron migration', () => {
  it('schedules the summary, reminder and cleanup jobs', async () => {
    const { rows } = await pg.query<{ jobname: string; schedule: string }>('select jobname, schedule from cron.job order by jobname');
    expect(rows).toEqual([
      { jobname: 'dayflow-daily-summary', schedule: '*/15 * * * *' },
      { jobname: 'dayflow-net-cleanup', schedule: '17 3 * * *' },
      { jobname: 'dayflow-reminders', schedule: '* * * * *' },
    ]);
  });

  it('runs a job command that calls the right function with the secret', async () => {
    const { rows } = await pg.query<{ command: string }>(`select command from cron.job where jobname = 'dayflow-daily-summary'`);
    await pg.exec(rows[0].command);
    const calls = await pg.query<{ url: string; headers: Record<string, string>; timeout: number }>('select * from net.calls');
    expect(calls.rows).toEqual([
      expect.objectContaining({
        url: 'https://abc.supabase.co/functions/v1/daily-summary',
        headers: { 'Content-Type': 'application/json', 'x-cron-secret': 'shh' },
        timeout: 30000,
      }),
    ]);
  });

  it('can be re-run without duplicating jobs', async () => {
    const sql = readFileSync('supabase/migrations/0002_cron.sql', 'utf8').replace(/^create extension.*$/gm, '');
    await pg.exec(sql);
    expect((await pg.query('select * from cron.job')).rows).toHaveLength(3);
  });
});
