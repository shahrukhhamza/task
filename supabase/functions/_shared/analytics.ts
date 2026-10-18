// Turns a user's tasks and history into the numbers behind the nightly email and the
// weekly report page. Pure functions over plain data: shared by the Edge Function and the app.

import { addDays, dayBounds, dayKeyOf, duration, hourLabel, localParts, longDayLabel, shortDayLabel, weekdayOfKey } from './zone.ts';

const MIN = 60_000;
const ACTIVE = new Set(['todo', 'scheduled', 'doing']);
/** Focus sessions closer together than this count as one streak. */
const STREAK_GAP_MIN = 15;

export interface BlockLike {
  start: number;
  end: number;
}

export interface TaskLike {
  id: string;
  title: string;
  category: string;
  priority: string;
  status: string;
  estimateMin: number;
  spentMin: number;
  dueAt?: number;
  fixedStart?: number;
  fixedEnd?: number;
  blocks: BlockLike[];
  createdAt: number;
  completedAt?: number;
  deletedAt?: number | null;
}

export interface EventLike {
  taskId: string;
  type: string;
  at: number;
  durationMin?: number;
  category?: string;
}

export interface FixedLike {
  title: string;
  start: number;
  end: number;
  deletedAt?: number | null;
}

export interface CheckinLike {
  date: string;
  mood: number;
  energy: number;
}

export interface HabitLike {
  id: string;
  title: string;
  days: number[];
  archived?: boolean;
  deletedAt?: number | null;
  createdAt: number;
}

export interface HabitLogLike {
  habitId: string;
  date: string;
  deletedAt?: number | null;
}

export interface HistoryInput {
  tasks: TaskLike[];
  events: EventLike[];
  fixed: FixedLike[];
  checkins: CheckinLike[];
  habits?: HabitLike[];
  habitLogs?: HabitLogLike[];
  timezone: string;
  /** Minutes after midnight. */
  peakStart: number;
  peakEnd: number;
}

export interface DayReport {
  date: string;
  label: string;
  planned: number;
  completedCount: number;
  /** % of planned tasks completed, or null when nothing was planned. */
  score: number | null;
  headline: string;
  completed: Array<{ title: string; category: string; plannedMin: number; actualMin: number | null }>;
  missed: Array<{ title: string; plannedMin: number }>;
  rescheduled: Array<{ title: string; times: number }>;
  categories: Array<{ category: string; minutes: number }>;
  focus: { totalMin: number; sessions: number; longestStreakMin: number; productiveHour: number | null };
  tomorrow: Array<{ title: string; start: number; end: number; kind: 'task' | 'appointment' | 'event' }>;
  deadlines: Array<{ title: string; dueAt: number; daysLeft: number }>;
  checkin?: { mood: number; energy: number };
  insight: string;
}

const alive = (t: TaskLike) => !t.deletedAt && t.status !== 'dropped';

/** Calendar days from one "yyyy-MM-dd" to another. */
const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

export function headlineFor(score: number | null, completed: number, planned: number): string {
  if (score === null) return completed > 0 ? `You got ${completed} thing${completed === 1 ? '' : 's'} done without a plan.` : 'A quiet day: nothing was planned.';
  if (score >= 90) return `Outstanding: you finished ${completed} of ${planned} planned tasks.`;
  if (score >= 70) return `Solid day: ${completed} of ${planned} done.`;
  if (score >= 40) return `Partial progress: ${completed} of ${planned} done.`;
  return `Tough day: ${completed} of ${planned} done. Tomorrow is a fresh plan.`;
}

interface Session {
  start: number;
  end: number;
  min: number;
}

function focusStats(sessions: Session[], tz: string) {
  const sorted = [...sessions].sort((a, b) => a.start - b.start);
  let longest = 0;
  let run = 0;
  let lastEnd = -Infinity;
  const byHour = new Map<number, number>();
  for (const s of sorted) {
    run = s.start - lastEnd <= STREAK_GAP_MIN * MIN ? run + s.min : s.min;
    longest = Math.max(longest, run);
    lastEnd = s.end;
    const hour = localParts(s.start, tz).hour;
    byHour.set(hour, (byHour.get(hour) ?? 0) + s.min);
  }
  let productiveHour: number | null = null;
  let best = 0;
  for (const [hour, min] of byHour) {
    if (min > best || (min === best && productiveHour !== null && hour < productiveHour)) {
      best = min;
      productiveHour = hour;
    }
  }
  return {
    totalMin: Math.round(sorted.reduce((sum, s) => sum + s.min, 0)),
    sessions: sorted.length,
    longestStreakMin: Math.round(longest),
    productiveHour,
  };
}

/** Everything except the insight, which needs this report for several days. */
function baseDayReport(input: HistoryInput, date: string, now: number): Omit<DayReport, 'insight'> {
  const tz = input.timezone;
  const { start, end } = dayBounds(date, tz);
  const inDay = (ts?: number) => ts !== undefined && ts >= start && ts < end;
  const tasks = input.tasks.filter(alive);
  const byId = new Map(input.tasks.map((t) => [t.id, t]));

  const completed = tasks.filter((t) => t.status === 'done' && inDay(t.completedAt));
  const missed = tasks.filter(
    (t) =>
      ACTIVE.has(t.status) &&
      ((inDay(t.dueAt) && (t.dueAt as number) <= now) ||
        (inDay(t.fixedStart) && (t.fixedEnd ?? (t.fixedStart as number)) <= now) ||
        t.blocks.some((b) => b.start >= start && b.start < end && b.end <= now)),
  );

  const dayEvents = input.events.filter((e) => inDay(e.at));
  const moves = new Map<string, number>();
  for (const e of dayEvents) if (e.type === 'rescheduled' || e.type === 'skipped') moves.set(e.taskId, (moves.get(e.taskId) ?? 0) + 1);
  const counted = new Set([...completed, ...missed].map((t) => t.id));
  const rescheduled = [...moves]
    .filter(([id]) => !counted.has(id) && byId.has(id) && alive(byId.get(id) as TaskLike))
    .map(([id, times]) => ({ title: (byId.get(id) as TaskLike).title, times }));

  const planned = completed.length + missed.length + rescheduled.length;
  const score = planned ? Math.round((completed.length / planned) * 100) : null;

  // time by category: real focus time when there is any, otherwise finished work
  const sessions: Session[] = dayEvents
    .filter((e) => e.type === 'focus' && (e.durationMin ?? 0) > 0)
    .map((e) => ({ start: e.at - (e.durationMin as number) * MIN, end: e.at, min: e.durationMin as number }));
  const cat = new Map<string, number>();
  if (sessions.length) {
    for (const e of dayEvents) {
      if (e.type !== 'focus' || !e.durationMin) continue;
      const c = e.category ?? byId.get(e.taskId)?.category ?? 'general';
      cat.set(c, (cat.get(c) ?? 0) + e.durationMin);
    }
  } else {
    for (const t of completed) cat.set(t.category, (cat.get(t.category) ?? 0) + (t.spentMin || t.estimateMin));
  }

  const next = dayBounds(addDays(date, 1), tz);
  const inNext = (ts: number) => ts >= next.start && ts < next.end;
  const tomorrow: DayReport['tomorrow'] = [];
  for (const t of tasks) {
    if (!ACTIVE.has(t.status)) continue;
    for (const b of t.blocks) if (inNext(b.start)) tomorrow.push({ title: t.title, start: b.start, end: b.end, kind: 'task' });
    if (t.fixedStart !== undefined && inNext(t.fixedStart)) {
      tomorrow.push({ title: t.title, start: t.fixedStart, end: t.fixedEnd ?? t.fixedStart, kind: 'appointment' });
    }
  }
  for (const f of input.fixed) if (!f.deletedAt && inNext(f.start)) tomorrow.push({ title: f.title, start: f.start, end: f.end, kind: 'event' });
  tomorrow.sort((a, b) => a.start - b.start);

  const horizon = dayBounds(addDays(date, 3), tz).end;
  const deadlines = tasks
    .filter((t) => ACTIVE.has(t.status) && t.dueAt !== undefined && t.dueAt >= end && t.dueAt < horizon)
    .sort((a, b) => (a.dueAt as number) - (b.dueAt as number))
    .map((t) => ({ title: t.title, dueAt: t.dueAt as number, daysLeft: daysBetween(date, dayKeyOf(t.dueAt as number, tz)) }));

  const checkin = input.checkins.find((c) => c.date === date);

  return {
    date,
    label: longDayLabel(date),
    planned,
    completedCount: completed.length,
    score,
    headline: headlineFor(score, completed.length, planned),
    completed: completed.map((t) => ({ title: t.title, category: t.category, plannedMin: t.estimateMin, actualMin: t.spentMin > 0 ? t.spentMin : null })),
    missed: missed.map((t) => ({ title: t.title, plannedMin: t.estimateMin })),
    rescheduled,
    categories: [...cat].map(([category, minutes]) => ({ category, minutes: Math.round(minutes) })).sort((a, b) => b.minutes - a.minutes),
    focus: focusStats(sessions, tz),
    tomorrow: tomorrow.slice(0, 12),
    deadlines,
    checkin: checkin && { mood: checkin.mood, energy: checkin.energy },
  };
}

// ------------------------------------------------------------------ insight of the day

interface Candidate {
  weight: number;
  text: string;
}

const pct = (n: number) => `${Math.round(Math.abs(n) * 100)}%`;

/** Picks the single most useful observation, from simple rules over today and recent days. */
export function insightFor(input: HistoryInput, report: Omit<DayReport, 'insight'>, now: number): string {
  const candidates: Candidate[] = [];

  // estimates vs reality
  const timed = report.completed.filter((c) => c.actualMin !== null);
  if (timed.length >= 2) {
    const ratio = timed.reduce((s, c) => s + (c.actualMin as number), 0) / timed.reduce((s, c) => s + c.plannedMin, 0);
    if (ratio >= 1.25) {
      candidates.push({ weight: 0.8, text: `Your tasks took ${pct(ratio - 1)} longer than estimated today. Dayflow pads estimates once it sees a pattern, so tomorrow’s plan will be more realistic.` });
    } else if (ratio <= 0.75) {
      candidates.push({ weight: 0.55, text: `You beat your estimates by ${pct(1 - ratio)} today. You might fit one more task in tomorrow.` });
    }
  }

  // focus outside the peak window
  const hour = report.focus.productiveHour;
  if (report.focus.totalMin >= 30 && hour !== null && (hour * 60 < input.peakStart || hour * 60 >= input.peakEnd)) {
    candidates.push({
      weight: 0.7,
      text: `Your most focused hour was ${hourLabel(hour)}, outside your peak window (${hourLabel(Math.floor(input.peakStart / 60))} to ${hourLabel(Math.floor(input.peakEnd / 60))}). If that’s typical, move your peak window in Settings.`,
    });
  }

  // recent history: streaks and energy
  const history: Array<{ date: string; score: number | null }> = [];
  for (let i = 0; i < 30; i++) {
    const date = addDays(report.date, -i);
    history.push({ date, score: i === 0 ? report.score : baseDayReport(input, date, now).score });
  }

  let streak = 0;
  for (const day of history) {
    if (day.score !== null && day.score >= 80) streak++;
    else break;
  }
  if (streak >= 3) candidates.push({ weight: 0.85, text: `${streak} days in a row at 80% or better. Keep the streak alive tomorrow.` });

  const scored = history
    .map((d) => ({ ...d, checkin: input.checkins.find((c) => c.date === d.date) }))
    .filter((d) => d.score !== null && d.checkin);
  const high = scored.filter((d) => (d.checkin as CheckinLike).energy >= 4);
  const low = scored.filter((d) => (d.checkin as CheckinLike).energy <= 2);
  if (scored.length >= 5 && high.length >= 2 && low.length >= 2) {
    const avg = (xs: typeof scored) => xs.reduce((s, d) => s + (d.score as number), 0) / xs.length;
    const diff = Math.round(avg(high) - avg(low));
    if (diff >= 15) {
      candidates.push({ weight: 0.75, text: `On days you rate your energy 4 or 5, you finish ${diff} points more of your plan. Protecting your sleep may be your best productivity tool.` });
    }
  }

  if (report.planned >= 6 && report.score !== null && report.score < 50) {
    candidates.push({
      weight: 0.8,
      text: `You planned ${report.planned} tasks and finished ${report.completedCount}. Try fewer, bigger blocks tomorrow; a smaller plan you finish beats a big one you don’t.`,
    });
  }

  if (report.focus.longestStreakMin >= 90) {
    candidates.push({ weight: 0.6, text: `Your longest focus stretch was ${duration(report.focus.longestStreakMin)}. That’s deep work; give tomorrow’s hardest task the same time slot.` });
  }

  if (report.deadlines.length >= 2) {
    candidates.push({ weight: 0.65, text: `${report.deadlines.length} deadlines in the next 3 days, starting with “${report.deadlines[0].title}”. Start on it early tomorrow.` });
  }

  if (report.missed.length >= 3) {
    candidates.push({ weight: 0.5, text: `${report.missed.length} tasks slipped today. Re-planning as soon as you fall behind keeps the rest of the day on track.` });
  }

  if (!candidates.length) {
    candidates.push({
      weight: 0.1,
      text:
        report.planned === 0
          ? 'Add tomorrow’s tasks tonight. Even one planned task makes the morning easier.'
          : 'Every finished task teaches Dayflow your pace. Using the focus timer makes tomorrow’s estimates more accurate.',
    });
  }
  return candidates.sort((a, b) => b.weight - a.weight)[0].text;
}

export function dayReport(input: HistoryInput, date: string, now: number): DayReport {
  const base = baseDayReport(input, date, now);
  return { ...base, insight: insightFor(input, base, now) };
}

// ------------------------------------------------------------------ habits

export const isScheduledOn = (habit: HabitLike, date: string): boolean => habit.days.includes(weekdayOfKey(date));

/**
 * Consecutive scheduled days the habit was done, counting back from `today`.
 * Today only breaks the streak once it's over, so an unchecked morning doesn't reset it.
 */
export function habitStreak(habit: HabitLike, logs: HabitLogLike[], today: string): { current: number; best: number } {
  const done = new Set(logs.filter((l) => l.habitId === habit.id && !l.deletedAt).map((l) => l.date));
  const createdKey = new Date(habit.createdAt).toISOString().slice(0, 10);

  let current = 0;
  let counting = true;
  let best = 0;
  let run = 0;
  for (let i = 0; i < 400; i++) {
    const date = addDays(today, -i);
    if (date < createdKey && !done.has(date)) break;
    if (!isScheduledOn(habit, date)) continue;
    if (done.has(date)) {
      run++;
      if (counting) current++;
    } else if (i === 0) {
      continue;
    } else {
      counting = false;
      best = Math.max(best, run);
      run = 0;
    }
  }
  best = Math.max(best, run, current);
  return { current, best };
}

// ------------------------------------------------------------------ weekly

export interface WeekReport {
  start: string;
  end: string;
  days: Array<{ date: string; label: string; score: number | null; completed: number; planned: number; focusMin: number }>;
  completed: number;
  planned: number;
  averageScore: number | null;
  previousAverageScore: number | null;
  focusMin: number;
  previousFocusMin: number;
  categories: Array<{ category: string; minutes: number }>;
  bestDay: { label: string; score: number } | null;
  mood: number | null;
  energy: number | null;
  habits: Array<{ title: string; done: number; scheduled: number; streak: number }>;
  insight: string;
}

const average = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

/** Seven days ending on `end` (inclusive), compared with the seven before. */
export function weekReport(input: HistoryInput, end: string, now: number): WeekReport {
  const keys = Array.from({ length: 7 }, (_, i) => addDays(end, i - 6));
  const prevKeys = keys.map((k) => addDays(k, -7));
  const days = keys.map((date) => {
    const r = baseDayReport(input, date, now);
    return { date, label: shortDayLabel(date), score: r.score, completed: r.completedCount, planned: r.planned, focusMin: r.focus.totalMin, categories: r.categories };
  });
  const prev = prevKeys.map((date) => baseDayReport(input, date, now));

  const cat = new Map<string, number>();
  for (const d of days) for (const c of d.categories) cat.set(c.category, (cat.get(c.category) ?? 0) + c.minutes);

  const scores = days.filter((d) => d.score !== null).map((d) => d.score as number);
  const prevScores = prev.filter((d) => d.score !== null).map((d) => d.score as number);
  const best = days.filter((d) => d.score !== null && d.planned > 0).sort((a, b) => (b.score as number) - (a.score as number))[0];

  const weekCheckins = input.checkins.filter((c) => c.date >= keys[0] && c.date <= end);
  const habits = (input.habits ?? [])
    .filter((h) => !h.deletedAt && !h.archived)
    .map((h) => {
      const logs = (input.habitLogs ?? []).filter((l) => l.habitId === h.id && !l.deletedAt);
      return {
        title: h.title,
        scheduled: keys.filter((k) => isScheduledOn(h, k)).length,
        done: keys.filter((k) => logs.some((l) => l.date === k)).length,
        streak: habitStreak(h, logs, end).current,
      };
    });

  const focusMin = days.reduce((s, d) => s + d.focusMin, 0);
  const previousFocusMin = prev.reduce((s, d) => s + d.focus.totalMin, 0);
  const averageScore = average(scores);
  const previousAverageScore = average(prevScores);
  const categories = [...cat].map(([category, minutes]) => ({ category, minutes })).sort((a, b) => b.minutes - a.minutes);

  let insight = 'A new week starts tomorrow. Plan Monday tonight and it will already be half won.';
  if (focusMin >= 60 && previousFocusMin >= 60) {
    const change = (focusMin - previousFocusMin) / previousFocusMin;
    if (change >= 0.2) insight = `You focused ${duration(focusMin)} this week, ${pct(change)} more than last week. Whatever you changed, keep it.`;
    else if (change <= -0.2) insight = `Focus time fell ${pct(change)} versus last week (${duration(focusMin)}). One protected morning block a day would win it back.`;
  } else if (averageScore !== null && previousAverageScore !== null && Math.abs(averageScore - previousAverageScore) >= 10) {
    insight = averageScore > previousAverageScore
      ? `Your average day score rose from ${Math.round(previousAverageScore)}% to ${Math.round(averageScore)}%.`
      : `Your average day score dropped from ${Math.round(previousAverageScore)}% to ${Math.round(averageScore)}%. Smaller plans may help next week.`;
  } else if (categories[0] && focusMin > 0) {
    insight = `Most of your time went to ${categories[0].category} (${duration(categories[0].minutes)}). Is that where you want it?`;
  }

  return {
    start: keys[0],
    end,
    days: days.map(({ categories: _c, ...d }) => d),
    completed: days.reduce((s, d) => s + d.completed, 0),
    planned: days.reduce((s, d) => s + d.planned, 0),
    averageScore: averageScore === null ? null : Math.round(averageScore),
    previousAverageScore: previousAverageScore === null ? null : Math.round(previousAverageScore),
    focusMin,
    previousFocusMin,
    categories,
    bestDay: best ? { label: longDayLabel(best.date), score: best.score as number } : null,
    mood: average(weekCheckins.map((c) => c.mood)),
    energy: average(weekCheckins.map((c) => c.energy)),
    habits,
    insight,
  };
}

export { dayKeyOf };
