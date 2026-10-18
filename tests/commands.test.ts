import { describe, expect, it } from 'vitest';
import { parseInput, resolveTarget } from '../src/lib/parser';
import type { ParsedCommand } from '../src/lib/parser';
import { CTX, at, makeTask } from './helpers';

const cmd = (input: string): ParsedCommand => {
  const r = parseInput(input, CTX);
  if (r.kind !== 'command') throw new Error(`expected command for "${input}", got ${r.kind}`);
  return r.command;
};

describe('push commands', () => {
  it('push gym to tomorrow', () => {
    expect(cmd('push gym to tomorrow')).toEqual({
      kind: 'push',
      target: 'gym',
      to: at(10, 20, 0),
      hasTime: false,
    });
  });
  it('move dentist to 5pm', () => {
    expect(cmd('move dentist to 5pm')).toMatchObject({ kind: 'push', target: 'dentist', to: at(10, 19, 17), hasTime: true });
  });
  it('postpone the assignment to friday', () => {
    expect(cmd('postpone the assignment to friday')).toMatchObject({ kind: 'push', target: 'assignment', to: at(10, 23, 0) });
  });
  it('reschedule call mom to tomorrow at 2pm', () => {
    expect(cmd('Reschedule call mom to tomorrow at 2pm')).toMatchObject({ kind: 'push', target: 'call mom', to: at(10, 20, 14), hasTime: true });
  });
});

describe('finish commands', () => {
  it.each([
    ['I finished the assignment', 'assignment'],
    ["I've completed my physics homework", 'physics homework'],
    ['done with gym', 'gym'],
    ['mark call mom as done', 'call mom'],
    ['call mom is done', 'call mom'],
    ["I'm done with the report.", 'report'],
  ])('%s', (input, target) => {
    expect(cmd(input)).toEqual({ kind: 'finish', target });
  });
});

describe('start commands', () => {
  it.each([
    ['start the assignment', 'assignment'],
    ["I'm starting gym now", 'gym'],
    ["let's work on the report", 'report'],
    ['begin physics homework', 'physics homework'],
  ])('%s', (input, target) => {
    expect(cmd(input)).toEqual({ kind: 'start', target });
  });
});

describe('late / behind commands', () => {
  it.each([
    ["I'm running 30 minutes late", 30],
    ["I'm an hour behind", 60],
    ['running 15 min late', 15],
    ["I'm 2 hours behind schedule", 120],
    ["I'm behind", undefined],
    ['running late', undefined],
    ['replan my day', undefined],
  ])('%s', (input, minutes) => {
    expect(cmd(input)).toEqual({ kind: 'late', minutes });
  });
});

describe('next and delete commands', () => {
  it.each(["what's next?", 'What should I do now', 'next task', 'up next'])('%s', (input) => {
    expect(cmd(input)).toEqual({ kind: 'next' });
  });
  it.each([
    ['delete call mom', 'call mom'],
    ['cancel the dentist appointment', 'dentist appointment'],
    ['remove gym', 'gym'],
  ])('%s', (input, target) => {
    expect(cmd(input)).toEqual({ kind: 'delete', target });
  });
});

describe('resolving command targets', () => {
  const tasks = [
    makeTask({ id: 'phys', title: 'Physics assignment' }),
    makeTask({ id: 'math', title: 'Math assignment' }),
    makeTask({ id: 'gym', title: 'Gym', category: 'fitness' }),
    makeTask({ id: 'mom', title: 'Call mom' }),
    makeTask({ id: 'dent', title: 'Dentist', category: 'health' }),
  ];

  it('matches a unique word', () => {
    expect(resolveTarget('physics', tasks)).toMatchObject({ kind: 'match', task: { id: 'phys' } });
  });
  it('is ambiguous when two tasks fit equally', () => {
    const r = resolveTarget('assignment', tasks);
    expect(r.kind).toBe('ambiguous');
    if (r.kind === 'ambiguous') expect(r.candidates.map((t) => t.id).sort()).toEqual(['math', 'phys']);
  });
  it('tolerates misheard spelling', () => {
    expect(resolveTarget('dentst', tasks)).toMatchObject({ kind: 'match', task: { id: 'dent' } });
  });
  it('falls back to single words', () => {
    expect(resolveTarget('gym session', tasks)).toMatchObject({ kind: 'match', task: { id: 'gym' } });
    expect(resolveTarget('dentist appointment', tasks)).toMatchObject({ kind: 'match', task: { id: 'dent' } });
  });
  it('returns none for unknown targets', () => {
    expect(resolveTarget('submarine', tasks).kind).toBe('none');
    expect(resolveTarget('gym', []).kind).toBe('none');
  });
});

describe('calendar command', () => {
  it('targets an existing task when there is no date', () => {
    expect(cmd('add gym to my calendar')).toEqual({ kind: 'calendar', target: 'gym' });
    expect(cmd('put the dentist appointment on my google calendar')).toEqual({ kind: 'calendar', target: 'dentist appointment' });
  });

  it('creates a new task when the sentence has a date', () => {
    const r = parseInput('add dentist Friday 4pm to my calendar', CTX);
    expect(r.kind).toBe('tasks');
    if (r.kind === 'tasks') expect(r.tasks[0]).toMatchObject({ title: 'Dentist', addToCalendar: true, fixedStart: at(10, 23, 16) });
  });
});
