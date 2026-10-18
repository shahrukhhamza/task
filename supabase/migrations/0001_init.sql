-- Dayflow core schema. Every user-owned table is protected by row level security:
-- a user can only ever read or write rows where user_id = auth.uid().
--
-- Conventions
--   * ids are text because the app generates them on the device (UUIDs, or stable
--     keys such as "<habit>:<date>"), which is what lets it work offline first.
--   * (user_id, id) is the primary key everywhere, so ON CONFLICT (user_id, id)
--     upserts work the same for every table.
--   * deleted_at marks soft deletes so deletions reach other devices.
--   * updated_at is supplied by the client; the trigger below ignores writes that
--     are older than what the server already has (last write wins).
--   * synced_at is stamped by the server on every accepted write. Devices pull by
--     synced_at, so an edit made offline (with an older updated_at) is still seen.

-- ---------------------------------------------------------------- helpers

create or replace function public.skip_stale_update()
returns trigger
language plpgsql
as $$
begin
  if new.updated_at < old.updated_at then
    return null; -- keep the newer row, drop this write silently
  end if;
  new.synced_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------- profiles

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  timezone text not null default 'Asia/Karachi',
  work_start int not null default 540 check (work_start between 0 and 1439),
  work_end int not null default 1080 check (work_end between 1 and 1440),
  peak_start int not null default 540,
  peak_end int not null default 720,
  max_chunk_min int not null default 90,
  max_focus_min int not null default 360,
  break_min int not null default 10,
  buffer_min int not null default 10,
  theme text not null default 'system' check (theme in ('system', 'light', 'dark')),
  voice_lang text not null default 'en-US',
  email_enabled boolean not null default false,
  email_time text not null default '21:30' check (email_time ~ '^[0-2][0-9]:[0-5][0-9]$'),
  email_recipient text not null default '',
  email_weekly boolean not null default true,
  reminders_enabled boolean not null default false,
  reminder_lead_min int not null default 5,
  updated_at timestamptz not null default 'epoch',
  synced_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- tasks

create table public.tasks (
  user_id uuid not null default auth.uid () references auth.users (id) on delete cascade,
  id text not null,
  title text not null,
  notes text,
  category text not null default 'general',
  priority text not null default 'med' check (priority in ('high', 'med', 'low')),
  due_at timestamptz,
  fixed_start timestamptz,
  fixed_end timestamptz,
  start_after timestamptz,
  carried_over_at timestamptz,
  estimate_min int not null default 30 check (estimate_min >= 0),
  spent_min int not null default 0 check (spent_min >= 0),
  status text not null default 'todo'
    check (status in ('todo', 'scheduled', 'doing', 'done', 'skipped', 'dropped')),
  recurrence jsonb,
  -- the planner's time blocks for this task: [{id, start, end, chunk, chunks, locked}]
  blocks jsonb not null default '[]'::jsonb,
  calendar_event_id text,
  add_to_calendar boolean not null default false,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  synced_at timestamptz not null default now(),
  deleted_at timestamptz,
  primary key (user_id, id)
);
create index tasks_user_synced_idx on public.tasks (user_id, synced_at);
create index tasks_user_status_idx on public.tasks (user_id, status) where deleted_at is null;

-- ---------------------------------------------------------------- task_events
-- Status history. Actual durations and the nightly summary are derived from here.

create table public.task_events (
  user_id uuid not null default auth.uid () references auth.users (id) on delete cascade,
  id text not null,
  task_id text not null,
  type text not null
    check (type in ('created', 'started', 'focus', 'completed', 'skipped', 'rescheduled', 'dropped')),
  at timestamptz not null,
  duration_min int,
  category text,
  updated_at timestamptz not null default now(),
  synced_at timestamptz not null default now(),
  primary key (user_id, id)
);
create index task_events_user_at_idx on public.task_events (user_id, at);
create index task_events_user_synced_idx on public.task_events (user_id, synced_at);

-- ---------------------------------------------------------------- fixed_events
-- Appointments and imported Google Calendar events the planner must not overlap.

create table public.fixed_events (
  user_id uuid not null default auth.uid () references auth.users (id) on delete cascade,
  id text not null,
  title text not null,
  start_at timestamptz not null,
  end_at timestamptz not null,
  source text not null default 'manual' check (source in ('manual', 'google')),
  external_id text,
  updated_at timestamptz not null default now(),
  synced_at timestamptz not null default now(),
  deleted_at timestamptz,
  primary key (user_id, id),
  check (end_at >= start_at)
);
create index fixed_events_user_start_idx on public.fixed_events (user_id, start_at);
create index fixed_events_user_synced_idx on public.fixed_events (user_id, synced_at);

-- ---------------------------------------------------------------- habits

create table public.habits (
  user_id uuid not null default auth.uid () references auth.users (id) on delete cascade,
  id text not null,
  title text not null,
  category text not null default 'general',
  days int[] not null default '{0,1,2,3,4,5,6}',
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  synced_at timestamptz not null default now(),
  deleted_at timestamptz,
  primary key (user_id, id)
);
create index habits_user_synced_idx on public.habits (user_id, synced_at);

create table public.habit_logs (
  user_id uuid not null default auth.uid () references auth.users (id) on delete cascade,
  id text not null,
  habit_id text not null,
  date date not null,
  updated_at timestamptz not null default now(),
  synced_at timestamptz not null default now(),
  deleted_at timestamptz,
  primary key (user_id, id)
);
create index habit_logs_user_date_idx on public.habit_logs (user_id, date);
create index habit_logs_user_synced_idx on public.habit_logs (user_id, synced_at);

-- ---------------------------------------------------------------- checkins

create table public.checkins (
  user_id uuid not null default auth.uid () references auth.users (id) on delete cascade,
  id text not null,
  date date not null,
  mood int not null check (mood between 1 and 5),
  energy int not null check (energy between 1 and 5),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  synced_at timestamptz not null default now(),
  primary key (user_id, id),
  unique (user_id, date)
);
create index checkins_user_synced_idx on public.checkins (user_id, synced_at);

-- ---------------------------------------------------------------- calendar_links
-- task id -> Google Calendar event id, so edits and deletes stay in sync.

create table public.calendar_links (
  user_id uuid not null default auth.uid () references auth.users (id) on delete cascade,
  id text not null,
  task_id text not null,
  event_id text not null,
  calendar_id text not null default 'primary',
  payload_hash text not null default '',
  updated_at timestamptz not null default now(),
  synced_at timestamptz not null default now(),
  deleted_at timestamptz,
  primary key (user_id, id)
);
create index calendar_links_user_synced_idx on public.calendar_links (user_id, synced_at);

-- ---------------------------------------------------------------- server-only tables
-- RLS is on and there are deliberately NO policies for the client roles, so only the
-- service role (Edge Functions) can read or write these.

create table public.google_tokens (
  user_id uuid primary key references auth.users (id) on delete cascade,
  refresh_token text not null,
  updated_at timestamptz not null default now()
);

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid (),
  user_id uuid not null default auth.uid () references auth.users (id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);

create table public.email_logs (
  id uuid primary key default gen_random_uuid (),
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('daily', 'weekly', 'test')),
  for_date date not null,
  status text not null check (status in ('sent', 'failed', 'skipped')),
  provider_id text,
  error text,
  created_at timestamptz not null default now()
);
-- at most one real summary of each kind per user per day; tests may repeat
create unique index email_logs_once_idx on public.email_logs (user_id, kind, for_date)
  where kind <> 'test' and status = 'sent';
create index email_logs_user_idx on public.email_logs (user_id, created_at desc);

create table public.reminders_sent (
  user_id uuid not null references auth.users (id) on delete cascade,
  block_id text not null,
  sent_at timestamptz not null default now(),
  primary key (user_id, block_id)
);

-- ---------------------------------------------------------------- stale-write guard

create trigger profiles_stale before update on public.profiles
  for each row execute function public.skip_stale_update ();
create trigger tasks_stale before update on public.tasks
  for each row execute function public.skip_stale_update ();
create trigger task_events_stale before update on public.task_events
  for each row execute function public.skip_stale_update ();
create trigger fixed_events_stale before update on public.fixed_events
  for each row execute function public.skip_stale_update ();
create trigger habits_stale before update on public.habits
  for each row execute function public.skip_stale_update ();
create trigger habit_logs_stale before update on public.habit_logs
  for each row execute function public.skip_stale_update ();
create trigger checkins_stale before update on public.checkins
  for each row execute function public.skip_stale_update ();
create trigger calendar_links_stale before update on public.calendar_links
  for each row execute function public.skip_stale_update ();

-- ---------------------------------------------------------------- row level security

alter table public.profiles enable row level security;
create policy "own profile" on public.profiles
  for all to authenticated
  using (id = auth.uid ())
  with check (id = auth.uid ());

-- the same policy for every table that carries user_id
do $$
declare
  t text;
begin
  foreach t in array array[
    'tasks', 'task_events', 'fixed_events', 'habits', 'habit_logs', 'checkins', 'calendar_links'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy "own rows" on public.%I for all to authenticated '
      'using (user_id = auth.uid ()) with check (user_id = auth.uid ())', t);
  end loop;
end;
$$;

-- push subscriptions: a user may register and remove their own devices, never read keys back
alter table public.push_subscriptions enable row level security;
create policy "register own device" on public.push_subscriptions
  for insert to authenticated with check (user_id = auth.uid ());
create policy "remove own device" on public.push_subscriptions
  for delete to authenticated using (user_id = auth.uid ());

-- email logs: users can see their own history; only the service role writes it
alter table public.email_logs enable row level security;
create policy "read own email log" on public.email_logs
  for select to authenticated using (user_id = auth.uid ());

alter table public.google_tokens enable row level security;
alter table public.reminders_sent enable row level security;

-- ---------------------------------------------------------------- new users

-- Creates the profile row for every new sign-up. updated_at stays at 'epoch' so that
-- settings a user already changed on a device win over these defaults on first sync.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email_recipient)
  values (new.id, coalesce(new.email, ''))
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user ();
