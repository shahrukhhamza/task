import { describe, expect, it } from 'vitest';
import { dayReport, habitStreak, insightFor, weekReport, type HistoryInput } from '../supabase/functions/_shared/analytics.ts';
import { renderDailyEmail, renderWeeklyEmail } from '../supabase/functions/_shared/email.ts';
import { addDays, dayBounds, dayKeyOf, localParts, zonedTime } from '../supabase/functions/_shared/zone.ts';
import { TZ, at, makeTask } from './helpers';

const DAY = '2026-10-19';
const NIGHT = at(10, 19, 22);

const focus = (taskId: string, endH: number, endM: number, min: number, category = 'study') => ({
  taskId,
  type: 'focus',
  at: at(10, 19, endH, endM),
  durationMin: min,
  category,
});

function fixture(): HistoryInput {
  return {
    timezone: TZ,
    peakStart: 9 * 60,
    peakEnd: 12 * 60,
    tasks: [
      makeTask({ id: 't1', title: 'Physics assignment', category: 'study', status: 'done', completedAt: at(10, 19, 11), estimateMin: 60, spentMin: 90 }),
      makeTask({ id: 't2', title: 'Call mom', category: 'personal', status: 'done', completedAt: at(10, 19, 15), estimateMin: 30 }),
      makeTask({ id: 't3', title: 'Report', status: 'scheduled', blocks: [{ id: 'b', taskId: 't3', start: at(10, 19, 13), end: at(10, 19, 14), chunk: 1, chunks: 1 }] }),
      makeTask({ id: 't4', title: 'Pay rent', status: 'todo', dueAt: at(10, 19, 18) }),
      makeTask({ id: 't5', title: 'Gym', status: 'scheduled', blocks: [{ id: 'g', taskId: 't5', start: at(10, 20, 9), end: at(10, 20, 10), chunk: 1, chunks: 1 }] }),
      makeTask({ id: 't6', title: 'Dentist', status: 'todo', fixedStart: at(10, 20, 15), fixedEnd: at(10, 20, 16) }),
      makeTask({ id: 't7', title: 'Essay', status: 'todo', dueAt: at(10, 21, 23) }),
      makeTask({ id: 't8', title: 'Deleted', status: 'done', completedAt: at(10, 19, 12), deletedAt: at(10, 19, 13) }),
    ],
    events: [
      focus('t1', 9, 50, 50),
      focus('t1', 10, 40, 40),
      focus('t2', 16, 25, 25, 'personal'),
      { taskId: 't5', type: 'rescheduled', at: at(10, 19, 12) },
    ],
    fixed: [{ title: 'Standup <team>', start: at(10, 20, 11), end: at(10, 20, 11, 30) }],
    checkins: [{ date: DAY, mood: 4, energy: 3 }],
  };
}

describe('timezone helpers', () => {
  it('finds local day bounds', () => {
    const { start, end } = dayBounds(DAY, TZ);
    expect(start).toBe(at(10, 19, 0));
    expect(end).toBe(at(10, 20, 0));
    expect(dayKeyOf(at(10, 19, 23, 59), TZ)).toBe(DAY);
  });

  it('handles a 25-hour DST day', () => {
    const { start, end } = dayBounds('2026-11-01', 'America/New_York');
    expect((end - start) / 3_600_000).toBe(25);
    expect(localParts(zonedTime(2026, 11, 1, 12, 0, 'America/New_York'), 'America/New_York').hour).toBe(12);
  });

  it('adds days across month ends', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
});

describe('day report', () => {
  const report = dayReport(fixture(), DAY, NIGHT);

  it('scores completed against planned work', () => {
    expect(report.completed.map((c) => c.title)).toEqual(['Physics assignment', 'Call mom']);
    expect(report.missed.map((c) => c.title).sort()).toEqual(['Pay rent', 'Report']);
    expect(report.rescheduled).toEqual([{ title: 'Gym', times: 1 }]);
    expect(report.planned).toBe(5);
    expect(report.score).toBe(40);
    expect(report.headline).toBe('Partial progress: 2 of 5 done.');
  });

  it('reports planned vs actual time', () => {
    expect(report.completed[0]).toMatchObject({ plannedMin: 60, actualMin: 90 });
    expect(report.completed[1]).toMatchObject({ plannedMin: 30, actualMin: null });
  });

  it('breaks focus time down by category', () => {
    expect(report.categories).toEqual([
      { category: 'study', minutes: 90 },
      { category: 'personal', minutes: 25 },
    ]);
  });

  it('computes focus stats', () => {
    // 9:00-9:50 and 10:00-10:40 are 10 minutes apart, so they form one 90-minute streak
    expect(report.focus).toEqual({ totalMin: 115, sessions: 3, longestStreakMin: 90, productiveHour: 9 });
  });

  it('lists tomorrow and upcoming deadlines', () => {
    expect(report.tomorrow.map((t) => `${t.kind}:${t.title}`)).toEqual(['task:Gym', 'event:Standup <team>', 'appointment:Dentist']);
    expect(report.deadlines).toEqual([{ title: 'Essay', dueAt: at(10, 21, 23), daysLeft: 2 }]);
    expect(report.checkin).toEqual({ mood: 4, energy: 3 });
  });

  it('falls back to finished work when nothing was timed', () => {
    const input = { ...fixture(), events: [] };
    expect(dayReport(input, DAY, NIGHT).categories).toEqual([
      { category: 'study', minutes: 90 },
      { category: 'personal', minutes: 30 },
    ]);
  });

  it('handles an empty day', () => {
    const r = dayReport({ ...fixture(), tasks: [], events: [] }, DAY, NIGHT);
    expect(r.score).toBeNull();
    expect(r.headline).toBe('A quiet day: nothing was planned.');
    expect(r.insight).toContain('Add tomorrow’s tasks tonight');
  });
});

describe('insight of the day', () => {
  it('celebrates deep work', () => {
    expect(dayReport(fixture(), DAY, NIGHT).insight).toContain('deep work');
  });

  it('notices focus outside the peak window', () => {
    const input = { ...fixture(), events: [focus('t1', 16, 0, 60)] };
    expect(dayReport(input, DAY, NIGHT).insight).toContain('outside your peak window');
  });

  it('flags estimates that run long', () => {
    const input = fixture();
    input.tasks[1] = { ...input.tasks[1], spentMin: 50 };
    input.events = [];
    expect(dayReport(input, DAY, NIGHT).insight).toMatch(/took \d+% longer than estimated/);
  });

  it('spots a streak of good days', () => {
    const tasks = [0, 1, 2].map((d) =>
      makeTask({ id: `s${d}`, title: `Win ${d}`, status: 'done', completedAt: at(10, 19 - d, 10) }),
    );
    const input: HistoryInput = { ...fixture(), tasks, events: [], fixed: [] };
    expect(dayReport(input, DAY, NIGHT).insight).toBe('3 days in a row at 80% or better. Keep the streak alive tomorrow.');
  });

  it('suggests a smaller plan after an overloaded day', () => {
    const tasks = Array.from({ length: 7 }, (_, i) => makeTask({ id: `m${i}`, title: `T${i}`, status: 'todo', dueAt: at(10, 19, 12) }));
    tasks.push(makeTask({ id: 'ok', status: 'done', completedAt: at(10, 19, 9) }));
    const input: HistoryInput = { ...fixture(), tasks, events: [], fixed: [] };
    expect(dayReport(input, DAY, NIGHT).insight).toContain('You planned 8 tasks and finished 1');
  });

  it('links energy check-ins to results', () => {
    const tasks: ReturnType<typeof makeTask>[] = [];
    const checkins = [];
    for (let d = 0; d < 8; d++) {
      const date = addDays(DAY, -d);
      const highEnergy = d % 2 === 0;
      checkins.push({ date, mood: 3, energy: highEnergy ? 5 : 1 });
      tasks.push(makeTask({ id: `a${d}`, status: 'done', completedAt: at(10, 19 - d, 10) }));
      tasks.push(makeTask({ id: `b${d}`, status: highEnergy ? 'done' : 'todo', completedAt: highEnergy ? at(10, 19 - d, 11) : undefined, dueAt: at(10, 19 - d, 12) }));
    }
    const input: HistoryInput = { ...fixture(), tasks, events: [], fixed: [], checkins };
    const base = dayReport(input, DAY, NIGHT);
    // the streak rule also fires (alternating days break it), so check the rule directly
    expect(insightFor(input, base, NIGHT)).toContain('energy 4 or 5');
  });
});

describe('habit streaks', () => {
  const daily = { id: 'h', title: 'Read', days: [0, 1, 2, 3, 4, 5, 6], createdAt: at(10, 1) };
  const log = (date: string) => ({ habitId: 'h', date });

  it('counts back from today without penalising an unchecked today', () => {
    const logs = ['2026-10-18', '2026-10-17', '2026-10-16'].map(log);
    expect(habitStreak(daily, logs, DAY)).toEqual({ current: 3, best: 3 });
    expect(habitStreak(daily, [...logs, log(DAY)], DAY).current).toBe(4);
  });

  it('breaks on a missed day and remembers the best run', () => {
    const logs = ['2026-10-18', '2026-10-15', '2026-10-14', '2026-10-13', '2026-10-12'].map(log);
    expect(habitStreak(daily, logs, DAY)).toEqual({ current: 1, best: 4 });
  });

  it('skips days the habit is not scheduled', () => {
    const weekdays = { ...daily, days: [1, 2, 3, 4, 5] };
    // Mon 19 (today, open), Fri 16, Thu 15 done; the weekend doesn't break it
    const logs = ['2026-10-16', '2026-10-15'].map(log);
    expect(habitStreak(weekdays, logs, DAY).current).toBe(2);
  });

  it('ignores un-checked (deleted) logs', () => {
    expect(habitStreak(daily, [{ ...log('2026-10-18'), deletedAt: 1 }], DAY).current).toBe(0);
  });
});

describe('week report', () => {
  it('summarises the week and compares with the previous one', () => {
    const input = fixture();
    input.events.push({ taskId: 't1', type: 'focus', at: at(10, 9, 10), durationMin: 60, category: 'study' });
    input.habits = [{ id: 'h', title: 'Read', days: [0, 1, 2, 3, 4, 5, 6], createdAt: at(10, 1) }];
    input.habitLogs = [{ habitId: 'h', date: '2026-10-19' }, { habitId: 'h', date: '2026-10-18' }];
    const w = weekReport(input, DAY, NIGHT);
    expect(w.start).toBe('2026-10-13');
    expect(w.days).toHaveLength(7);
    expect(w.days[6]).toMatchObject({ date: DAY, score: 40, focusMin: 115 });
    expect(w.focusMin).toBe(115);
    expect(w.previousFocusMin).toBe(60);
    expect(w.habits).toEqual([{ title: 'Read', done: 2, scheduled: 7, streak: 2 }]);
    expect(w.insight).toContain('more than last week');
    expect(w.bestDay).toEqual({ label: 'Monday, Oct 19', score: 40 });
  });
});

describe('emails', () => {
  const ctx = { timezone: TZ, appUrl: 'https://dayflow.app', unsubscribeUrl: 'https://fn/unsub?u=1&t=abc', settingsUrl: 'https://dayflow.app/settings' };

  it('renders the daily email with escaped content and both colour schemes', () => {
    const input = fixture();
    input.tasks[0] = { ...input.tasks[0], title: '<script>alert(1)</script> & "quotes"' };
    const { subject, html, text } = renderDailyEmail(dayReport(input, DAY, NIGHT), ctx);
    expect(subject).toBe('Your day: 40% · 2 of 5 done');
    expect(html).not.toContain('<script>alert');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;quotes&quot;');
    expect(html).toContain('Standup &lt;team&gt;');
    expect(html).toContain('prefers-color-scheme: dark');
    expect(html).toContain('name="color-scheme" content="light dark"');
    expect(html).toContain('https://fn/unsub?u=1&amp;t=abc');
    expect(html).toContain('Where your time went');
    expect(html).toContain('Insight of the day');
    expect(html).not.toMatch(/<img|https?:\/\/(?!dayflow\.app|fn\/|www\.w3\.org)/);
    expect(text).toContain('Day score: 40%');
    expect(text).toContain('Unsubscribe: https://fn/unsub?u=1&t=abc');
  });

  it('renders an empty day gracefully', () => {
    const { subject, html } = renderDailyEmail(dayReport({ ...fixture(), tasks: [], events: [], fixed: [] }, DAY, NIGHT), ctx);
    expect(subject).toBe('Your day in Dayflow · Monday, Oct 19');
    expect(html).toContain('Nothing was planned for today.');
  });

  it('renders the weekly email', () => {
    const { subject, html, text } = renderWeeklyEmail(weekReport(fixture(), DAY, NIGHT), ctx);
    expect(subject).toMatch(/^Your week: 40% average · 1h 55m focus$/);
    expect(html).toContain('Day by day');
    expect(html).toContain('https://dayflow.app/report');
    expect(text).toContain('Mon: 40%');
  });
});
