import { describe, expect, it, vi } from 'vitest';
import type { AiParseResult } from '../src/lib/ai/convert';
import { parseInput } from '../src/lib/parser';
import { isEcho, overlap } from '../src/lib/voice/echo';
import { fastUnderstand, isConfident, looksEnglish, type Smarts } from '../src/lib/voice/fastUnderstand';
import { CTX } from './helpers';

const ai = (answer: AiParseResult | 'throw' | 'hang', available = true): Smarts & { calls: number } => {
  const state = { calls: 0 };
  return {
    get calls() {
      return state.calls;
    },
    available: () => available,
    understand: async () => {
      state.calls += 1;
      if (answer === 'throw') throw new Error('quota');
      if (answer === 'hang') return new Promise<AiParseResult>(() => {});
      return answer;
    },
  };
};

describe('the parser answers first, Gemini only when needed', () => {
  it.each(['delete task 2', 'gym at 6 pm', 'move it to tomorrow', 'update the meeting from 6 pm to 7 pm', 'call mom', 'dentist friday at 4pm', 'undo that'])(
    'does not ask Gemini about "%s"',
    async (text) => {
      const smart = ai({ kind: 'reply', text: 'should not be used' });
      const result = await fastUnderstand(text, CTX, [], smart);
      expect(smart.calls).toBe(0);
      expect(result.kind === 'tasks' || result.kind === 'command').toBe(true);
    },
  );

  it('asks Gemini for other languages', async () => {
    const answer: AiParseResult = { kind: 'tasks', tasks: [{ raw: 'x', title: 'امی کو فون کرنا' }] };
    const smart = ai(answer);
    expect(await fastUnderstand('امی کو فون کرنا شام کو', CTX, [], smart)).toBe(answer);
    expect(smart.calls).toBe(1);
  });

  it('asks Gemini for rambling sentences the parser cannot really read', async () => {
    const text = 'just keep the one to us which is the thing we talked about yesterday';
    expect(isConfident(parseInput(text, CTX), text)).toBe(false);
    const smart = ai({ kind: 'reply', text: 'Which task do you mean?' });
    expect((await fastUnderstand(text, CTX, [], smart)).kind).toBe('reply');
  });

  it('falls back to the parser when Gemini fails, is off, or is too slow', async () => {
    const text = 'just keep the one to us which is the thing we talked about yesterday';
    expect((await fastUnderstand(text, CTX, [], ai('throw'))).kind).toBe('tasks');
    expect((await fastUnderstand(text, CTX, [], ai({ kind: 'reply', text: 'x' }, false))).kind).toBe('tasks');
    vi.useFakeTimers();
    const slow = fastUnderstand(text, CTX, [], ai('hang'), 4000);
    await vi.advanceTimersByTimeAsync(4001);
    expect((await slow).kind).toBe('tasks');
    vi.useRealTimers();
  });

  it('ignores an empty answer from Gemini', async () => {
    const text = 'just keep the one to us which is the thing we talked about yesterday';
    expect((await fastUnderstand(text, CTX, [], ai({ kind: 'empty' }))).kind).toBe('tasks');
  });

  it('tells English from other scripts', () => {
    expect(looksEnglish('add a meeting at 6 p.m. - it’s “important”')).toBe(true);
    expect(looksEnglish('اپنی میٹنگ حذف کریں')).toBe(false);
    expect(looksEnglish('मीटिंग जोड़ो')).toBe(false);
  });
});

describe('echo and duplicates', () => {
  const spoken = { text: 'Added Meeting, from 6 to 7 PM.', at: 1000 };

  it('drops the assistant’s own voice coming back through the speaker', () => {
    expect(isEcho('added meeting from 6 to 7 PM', { spoken }, 3000)).toBe(true);
    expect(isEcho('added meeting from 6', { spoken }, 3000)).toBe(true);
  });

  it('keeps a real command, even one that shares a word', () => {
    expect(isEcho('delete task 1', { spoken }, 3000)).toBe(false);
    expect(isEcho('undo', { spoken }, 3000)).toBe(false);
    expect(isEcho('move the meeting to tomorrow', { spoken }, 3000)).toBe(false);
  });

  it('drops the final version of a sentence that was already handled from the live transcript', () => {
    const handled = { text: 'add a meeting from 6 pm to 7 pm', at: 1000 };
    expect(isEcho('add a meeting from 6 pm to 7 pm', { handled }, 2200)).toBe(true);
    expect(isEcho('add a meeting from 6 pm to 7', { handled }, 2200)).toBe(true);
  });

  it('lets the same short command be said again a moment later', () => {
    const handled = { text: 'undo', at: 1000 };
    expect(isEcho('undo', { handled }, 4000)).toBe(false); // 3 s later: a new request
    expect(isEcho('delete task 1', { handled }, 1500)).toBe(false);
  });

  it('forgets old speech', () => {
    expect(isEcho('added meeting from 6 to 7 PM', { spoken }, 30_000)).toBe(false);
  });

  it('measures word overlap', () => {
    expect(overlap('a b c d', 'a b c d e f')).toBe(1);
    expect(overlap('a b x y', 'a b c d')).toBe(0.5);
    expect(overlap('', 'a')).toBe(0);
  });
});
