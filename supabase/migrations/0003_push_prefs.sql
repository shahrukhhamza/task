-- What a user wants pushed to their phone, beyond the reminder before each block.
-- They all sit behind reminders_enabled, the master switch.

alter table public.profiles
  add column push_morning boolean not null default true,
  add column push_morning_time text not null default '08:00'
    check (push_morning_time ~ '^[0-2][0-9]:[0-5][0-9]$'),
  add column push_deadlines boolean not null default true,
  add column push_evening boolean not null default true,
  add column push_evening_time text not null default '20:30'
    check (push_evening_time ~ '^[0-2][0-9]:[0-5][0-9]$');
