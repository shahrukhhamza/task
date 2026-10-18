import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useState } from 'react';
import { db, ensureProfile } from '../lib/db/schema';
import { buildPlan, statsFromTasks, type Plan } from '../lib/scheduler';
import { DEFAULT_PROFILE, type FixedEvent, type Profile, type Task } from '../lib/types';

/** Re-renders on an interval so "now" lines and countdowns stay current. */
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

export interface PlannerData {
  loading: boolean;
  tasks: Task[];
  fixedEvents: FixedEvent[];
  profile: Profile;
  now: number;
  /** What the planner would produce if it ran right now. Used for risks and feasibility. */
  livePlan: Plan;
}

export function useData(): PlannerData {
  const now = useNow();
  const tasksRaw = useLiveQuery(() => db.tasks.toArray(), []);
  const eventsRaw = useLiveQuery(() => db.fixedEvents.toArray(), []);
  const profileRaw = useLiveQuery(() => db.profile.get('me'), []);

  useEffect(() => {
    void ensureProfile();
  }, []);

  const tasks = useMemo(() => (tasksRaw ?? []).filter((t) => !t.deletedAt), [tasksRaw]);
  const fixedEvents = useMemo(() => (eventsRaw ?? []).filter((e) => !e.deletedAt), [eventsRaw]);
  const profile = useMemo(() => ({ ...DEFAULT_PROFILE, ...profileRaw }), [profileRaw]);

  // minute resolution is plenty; avoids re-planning on every tick of a timer
  const minute = Math.floor(now / 60_000);
  const livePlan = useMemo(
    () => buildPlan({ tasks, fixedEvents, profile, now: minute * 60_000, estimates: statsFromTasks(tasks) }),
    [tasks, fixedEvents, profile, minute],
  );

  return {
    loading: tasksRaw === undefined || eventsRaw === undefined || profileRaw === undefined,
    tasks,
    fixedEvents,
    profile,
    now,
    livePlan,
  };
}
