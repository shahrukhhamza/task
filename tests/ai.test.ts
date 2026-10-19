import { describe, expect, it } from 'vitest';
import { createAiHandler } from '../supabase/functions/ai/handler.ts';
import { AiError, chooseModel, generateJson, pickModel, readJson } from '../supabase/functions/_shared/gemini.ts';
import { toParseResult, toParsedTask, type AiParse } from '../src/lib/ai/convert';
import { endOfDayTz } from '../src/lib/time/tz';
import { CTX, TZ, at } from './helpers';

const model = (name: string, methods = ['generateContent']) => ({ name: `models/${name}`, supportedGenerationMethods: methods });

describe('choosing a model', () => {
  it('prefers the newest stable full Flash', () => {
    expect(
      pickModel([
        model('gemini-2.5-flash'),
        model('gemini-2.5-flash-lite'),
        model('gemini-3.5-flash'),
        model('gemini-3.5-flash-lite'),
        model('gemini-3.5-flash-preview-09-2026'),
        model('gemini-3.5-pro'),
        model('text-embedding-004', ['embedContent']),
      ]),
    ).toBe('gemini-3.5-flash');
  });

  it('skips special-purpose and preview models when a stable one exists', () => {
    expect(pickModel([model('gemini-3-flash-preview'), model('gemini-3-flash-image'), model('gemini-2.5-flash')])).toBe('gemini-2.5-flash');
    expect(pickModel([model('gemini-3-flash-preview'), model('gemini-3-flash-tts')])).toBe('gemini-3-flash-preview');
  });

  it('falls back to the flash alias, or nothing', () => {
    expect(pickModel([model('gemini-flash-latest')])).toBe('gemini-flash-latest');
    expect(pickModel([model('gemini-3.5-pro')])).toBeNull();
  });
});

function fakeFetch(handler: (url: string, init: RequestInit) => { status: number; body: unknown }) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fn = (async (url: string, init: RequestInit = {}) => {
    calls.push({ url, init });
    const { status, body } = handler(url, init);
    return new Response(JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

const answer = (obj: unknown) => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }] } }] });

describe('Gemini client', () => {
  it('sends the key as a header, the system prompt and the JSON schema', async () => {
    const f = fakeFetch(() => ({ status: 200, body: answer({ ok: true }) }));
    const result = await generateJson<{ ok: boolean }>('KEY', 'gemini-x-flash', { system: 'sys', prompt: 'hi', schema: { type: 'OBJECT' } }, f.fn);
    expect(result).toEqual({ ok: true });
    const { url, init } = f.calls[0];
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-x-flash:generateContent');
    expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe('KEY');
    expect(url).not.toContain('KEY');
    const body = JSON.parse(String(init.body));
    expect(body.systemInstruction.parts[0].text).toBe('sys');
    expect(body.generationConfig).toMatchObject({ responseMimeType: 'application/json', responseSchema: { type: 'OBJECT' } });
  });

  it('maps failures to clear codes', async () => {
    const run = async (status: number, message = '') => {
      const f = fakeFetch(() => ({ status, body: { error: { message } } }));
      return generateJson('K', 'm', { system: '', prompt: '', schema: { type: 'OBJECT' } }, f.fn).catch((e: AiError) => e.code);
    };
    expect(await run(400, 'API key not valid. Please pass a valid API key.')).toBe('invalid_key');
    expect(await run(403)).toBe('invalid_key');
    expect(await run(429, 'Resource exhausted')).toBe('rate_limited');
    expect(await run(404, 'model not found')).toBe('no_model');
    expect(await run(500)).toBe('bad_response');
  });

  it('times out instead of hanging', async () => {
    const slow = ((_: string, init: RequestInit) =>
      new Promise((_, reject) => init.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))))) as unknown as typeof fetch;
    await expect(generateJson('K', 'm', { system: '', prompt: '', schema: { type: 'OBJECT' } }, slow, 20)).rejects.toMatchObject({ code: 'timeout' });
  });

  it('reads JSON answers, including fenced ones, and rejects blocked or broken ones', () => {
    expect(readJson(answer({ a: 1 }))).toEqual({ a: 1 });
    expect(readJson({ candidates: [{ content: { parts: [{ text: '```json\n{"a":2}\n```' }] } }] })).toEqual({ a: 2 });
    expect(() => readJson({ promptFeedback: { blockReason: 'SAFETY' } })).toThrow(AiError);
    expect(() => readJson({ candidates: [{ content: { parts: [{ text: 'not json' }] } }] })).toThrow(/valid JSON/);
  });

  it('lists models and picks one', async () => {
    const f = fakeFetch(() => ({ status: 200, body: { models: [model('gemini-2.5-flash'), model('gemini-3-flash')] } }));
    expect(await chooseModel('K', f.fn)).toBe('gemini-3-flash');
  });
});

describe('turning Gemini answers into tasks', () => {
  it('builds appointments with times in the user’s timezone', () => {
    const t = toParsedTask({ title: 'dentist', kind: 'fixed', date: '2026-10-23', time: '16:00', priority: 'med', category: 'health' }, CTX);
    expect(t).toMatchObject({ title: 'Dentist', fixedStart: at(10, 23, 16), fixedEnd: at(10, 23, 17), durationMin: 60, category: 'health' });
  });

  it('uses the end time when given', () => {
    const t = toParsedTask({ title: 'Client meeting', kind: 'fixed', date: '2026-10-20', time: '15:00', endTime: '16:30', priority: 'med', category: 'work' }, CTX);
    expect(t).toMatchObject({ fixedStart: at(10, 20, 15), fixedEnd: at(10, 20, 16, 30), durationMin: 90 });
  });

  it('builds deadlines, end-of-day when no time is given', () => {
    expect(toParsedTask({ title: 'Essay', kind: 'deadline', date: '2026-10-22', priority: 'high', category: 'study', durationMin: 120 }, CTX)).toMatchObject({
      dueAt: endOfDayTz(at(10, 22, 12), TZ),
      priority: 'high',
      durationMin: 120,
    });
    expect(toParsedTask({ title: 'Report', kind: 'deadline', date: '2026-10-23', time: '17:00', priority: 'med', category: 'work' }, CTX)?.dueAt).toBe(at(10, 23, 17));
  });

  it('keeps flexible tasks open and supports any script', () => {
    const t = toParsedTask({ title: 'امی کو فون کرنا', kind: 'flexible', priority: 'med', category: 'personal' }, CTX);
    expect(t).toMatchObject({ title: 'امی کو فون کرنا', category: 'personal' });
    expect(t?.dueAt).toBeUndefined();
    expect(t?.fixedStart).toBeUndefined();
  });

  it('cleans up nonsense instead of trusting it', () => {
    expect(toParsedTask({ title: '   ', kind: 'flexible' }, CTX)).toBeNull();
    const t = toParsedTask(
      { title: 'x'.repeat(300), kind: 'fixed', date: 'next friday', time: '25:99', durationMin: 99999, priority: 'urgent', category: 'space' },
      CTX,
    );
    expect(t?.title).toHaveLength(120);
    expect(t?.fixedStart).toBeUndefined();
    expect(t?.durationMin).toBe(720);
    expect(t?.priority).toBeUndefined();
    expect(t?.category).toBeUndefined();
  });

  it('converts repeats', () => {
    const t = toParsedTask({ title: 'Gym', kind: 'fixed', time: '18:00', priority: 'med', category: 'fitness', repeat: { freq: 'weekly', days: [5, 1, 3, 9] } }, CTX);
    expect(t?.recurrence).toEqual({ freq: 'weekly', interval: 1, byDay: [1, 3, 5] });
  });

  it('turns commands, habits and replies into results', () => {
    const cmd = (command: AiParse['command']) => toParseResult({ intent: 'command', command }, CTX, 'x');
    expect(cmd({ action: 'push', target: 'gym', date: '2026-10-20' })).toEqual({ kind: 'command', raw: 'x', command: { kind: 'push', target: 'gym', to: at(10, 20, 0), hasTime: false } });
    expect(cmd({ action: 'push', target: 'gym', date: '2026-10-20', time: '19:00' })).toMatchObject({ command: { to: at(10, 20, 19), hasTime: true } });
    expect(cmd({ action: 'finish', target: 'Physics assignment' })).toMatchObject({ command: { kind: 'finish', target: 'Physics assignment' } });
    expect(cmd({ action: 'late', minutes: 30 })).toMatchObject({ command: { kind: 'late', minutes: 30 } });
    expect(cmd({ action: 'push', target: 'gym' })).toEqual({ kind: 'empty' });

    expect(toParseResult({ intent: 'habit', habit: { title: 'Meditate', days: [1, 2, 3, 4, 5] } }, CTX, '')).toEqual({ kind: 'habit', habit: { title: 'Meditate', days: [1, 2, 3, 4, 5] } });
    expect(toParseResult({ intent: 'none', reply: 'Try adding a task.' }, CTX, '')).toEqual({ kind: 'reply', text: 'Try adding a task.' });
    expect(toParseResult({}, CTX, '')).toEqual({ kind: 'empty' });
  });
});

describe('ai Edge Function', () => {
  const request = (body: unknown, user: string | null = 'u1') =>
    new Request('https://fn/ai', { method: 'POST', headers: user ? { Authorization: `Bearer ${user}` } : {}, body: JSON.stringify(body) });
  const valid = { system: 's', prompt: 'p', schema: { type: 'OBJECT' } };

  it('requires a server key and a signed-in user', async () => {
    const noKey = createAiHandler({ fetch, apiKey: '', authenticate: async () => 'u1' });
    expect(await (await noKey(request(valid))).json()).toMatchObject({ error: 'not_configured' });
    const f = fakeFetch(() => ({ status: 200, body: answer({}) }));
    const handle = createAiHandler({ fetch: f.fn, apiKey: 'K', model: 'm', authenticate: async (r) => r.headers.get('Authorization')?.slice(7) ?? null });
    expect((await handle(request(valid, null))).status).toBe(401);
  });

  it('validates and limits the request', async () => {
    const f = fakeFetch(() => ({ status: 200, body: answer({}) }));
    const handle = createAiHandler({ fetch: f.fn, apiKey: 'K', model: 'm', authenticate: async () => 'u1' });
    expect((await handle(request({ prompt: 'p' }))).status).toBe(400);
    expect((await handle(request({ ...valid, prompt: 'x'.repeat(7000) }))).status).toBe(413);
  });

  it('proxies to Gemini and returns the JSON', async () => {
    const f = fakeFetch((url) => (url.includes('/models?') ? { status: 200, body: { models: [model('gemini-3-flash')] } } : { status: 200, body: answer({ brief: 'hi' }) }));
    const handle = createAiHandler({ fetch: f.fn, apiKey: 'K', authenticate: async () => 'u1' });
    expect(await (await handle(request(valid))).json()).toEqual({ json: { brief: 'hi' } });
    expect(f.calls[1].url).toContain('/models/gemini-3-flash:generateContent');
  });

  it('hides key problems from the browser and passes rate limits through', async () => {
    const bad = fakeFetch(() => ({ status: 400, body: { error: { message: 'API key not valid: AIza...secret' } } }));
    const r1 = await createAiHandler({ fetch: bad.fn, apiKey: 'K', model: 'm', authenticate: async () => 'u1' })(request(valid));
    const body1 = await r1.json();
    expect(body1.error).toBe('not_configured');
    expect(JSON.stringify(body1)).not.toContain('AIza');

    const limited = fakeFetch(() => ({ status: 429, body: { error: { message: 'quota' } } }));
    const r2 = await createAiHandler({ fetch: limited.fn, apiKey: 'K', model: 'm', authenticate: async () => 'u1' })(request(valid));
    expect(r2.status).toBe(429);
    expect((await r2.json()).error).toBe('rate_limited');
  });
});
