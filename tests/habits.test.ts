import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { describeDays, parseHabit } from '../src/lib/habits';

describe('parseHabit', () => {
  it('ignores normal tasks', () => {
    expect(parseHabit('Gym at 6pm')).toBeNull();
    expect(parseHabit('habitat restoration meeting')).toBeNull();
  });

  it('defaults to every day', () => {
    expect(parseHabit('habit: read 20 pages')).toEqual({ title: 'Read 20 pages', days: [0, 1, 2, 3, 4, 5, 6], category: 'personal' });
  });

  it('reads weekday schedules', () => {
    expect(parseHabit('new habit meditate every weekday')?.days).toEqual([1, 2, 3, 4, 5]);
    expect(parseHabit('habit - gym every Monday, Wednesday and Friday')).toEqual({ title: 'Gym', days: [1, 3, 5], category: 'fitness' });
    expect(parseHabit('add a habit: stretch daily')).toMatchObject({ title: 'Stretch', days: [0, 1, 2, 3, 4, 5, 6] });
  });
});

describe('describeDays', () => {
  it('names common schedules', () => {
    expect(describeDays([0, 1, 2, 3, 4, 5, 6])).toBe('Every day');
    expect(describeDays([5, 1, 2, 3, 4])).toBe('Weekdays');
    expect(describeDays([0, 6])).toBe('Weekends');
    expect(describeDays([1, 3])).toBe('Mon, Wed');
  });
});
