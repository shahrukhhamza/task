import { beforeEach, describe, expect, it } from 'vitest';
import { createHandler, normalizeEvent, type GoogleDeps } from '../supabase/functions/google-calendar/handler.ts';

interface Call {
  url: string;
  method: string;
  body?: string;
  auth?: string;
}

/** A scripted stand-in for Google's token and Calendar endpoints. */
function fakeGoogle() {
  const calls: Call[] = [];
  const state = {
    tokenError: null as string | null,
    issued: 0,
    validToken: 'access-1',
    events: new Map<string, Record<string, unknown>>(),
    nextId: 1,
  };

  const fetchFn = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    const method = init.method ?? 'GET';
    const auth = (init.headers as Record<string, string> | undefined)?.Authorization;
    calls.push({ url, method, body: init.body ? String(init.body) : undefined, auth });
    const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

    if (url.startsWith('https://oauth2.googleapis.com/token')) {
      if (state.tokenError) return reply(400, { error: state.tokenError });
      state.issued++;
      state.validToken = `access-${state.issued}`;
      return reply(200, { access_token: state.validToken, expires_in: 3600 });
    }
    if (url.startsWith('https://oauth2.googleapis.com/revoke')) return reply(200, {});

    if (auth !== `Bearer ${state.validToken}`) return reply(401, { error: 'invalid_token' });

    const base = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';
    if (url.startsWith(base)) {
      const rest = url.slice(base.length);
      if (method === 'GET') return reply(200, { items: [...state.events.values()] });
      if (method === 'POST') {
        const parsed = JSON.parse(String(init.body));
        const id = parsed.id ?? `evt${state.nextId++}`;
        if (state.events.has(id)) return reply(409, { error: 'duplicate' });
        state.events.set(id, { ...parsed, id });
        return reply(200, { id });
      }
      const id = decodeURIComponent(rest.slice(1));
      if (!state.events.has(id)) return reply(404, {});
      if (method === 'PUT') {
        state.events.set(id, { id, ...JSON.parse(String(init.body)) });
        return reply(200, { id });
      }
      if (method === 'DELETE') {
        state.events.delete(id);
        return new Response(null, { status: 204 });
      }
    }
    return reply(500, {});
  }) as typeof fetch;

  return { fetch: fetchFn, calls, state };
}

let google: ReturnType<typeof fakeGoogle>;
let tokens: Map<string, string>;
let clock: number;
let handle: (req: Request) => Promise<Response>;

const call = async (body: unknown, user: string | null = 'u1') => {
  const res = await handle(
    new Request('https://fn/google-calendar', {
      method: 'POST',
      headers: user ? { Authorization: `Bearer ${user}` } : {},
      body: JSON.stringify(body),
    }),
  );
  return { status: res.status, body: (await res.json()) as Record<string, any> };
};

beforeEach(() => {
  google = fakeGoogle();
  tokens = new Map([['u1', 'refresh-1']]);
  clock = 1_000_000;
  const deps: GoogleDeps = {
    fetch: google.fetch,
    clientId: 'cid',
    clientSecret: 'secret',
    authenticate: async (req) => req.headers.get('Authorization')?.replace('Bearer ', '') ?? null,
    getRefreshToken: async (u) => tokens.get(u) ?? null,
    saveRefreshToken: async (u, t) => void tokens.set(u, t),
    deleteRefreshToken: async (u) => void tokens.delete(u),
    now: () => clock,
  };
  handle = createHandler(deps);
});

describe('google-calendar function', () => {
  it('rejects unauthenticated calls and handles CORS preflight', async () => {
    expect((await call({ action: 'status' }, null)).status).toBe(401);
    const pre = await handle(new Request('https://fn', { method: 'OPTIONS' }));
    expect(pre.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });

  it('stores a refresh token and reports status', async () => {
    tokens.clear();
    expect((await call({ action: 'status' })).body).toEqual({ status: 'disconnected' });
    expect((await call({ action: 'store-token', refreshToken: 'r2' })).body).toEqual({ ok: true });
    expect(tokens.get('u1')).toBe('r2');
    expect((await call({ action: 'status' })).body).toEqual({ status: 'connected' });
  });

  it('sends the client secret only to Google’s token endpoint', async () => {
    await call({ action: 'list', timeMin: 'a', timeMax: 'b' });
    const tokenCall = google.calls.find((c) => c.url.includes('/token'));
    expect(tokenCall?.body).toContain('client_secret=secret');
    expect(tokenCall?.body).toContain('refresh_token=refresh-1');
    expect(google.calls.filter((c) => c.url.includes('/calendar/')).every((c) => !c.body?.includes('secret'))).toBe(true);
  });

  it('caches the access token until it is about to expire', async () => {
    await call({ action: 'list', timeMin: 'a', timeMax: 'b' });
    await call({ action: 'list', timeMin: 'a', timeMax: 'b' });
    expect(google.state.issued).toBe(1);
    clock += 3600_000;
    await call({ action: 'list', timeMin: 'a', timeMax: 'b' });
    expect(google.state.issued).toBe(2);
  });

  it('refreshes once and retries when Google rejects the access token', async () => {
    await call({ action: 'list', timeMin: 'a', timeMax: 'b' });
    google.state.validToken = 'rotated-elsewhere';
    // next refresh issues access-2, which the fake then accepts
    const res = await call({ action: 'list', timeMin: 'a', timeMax: 'b' });
    expect(res.status).toBe(200);
    expect(google.state.issued).toBe(2);
  });

  it('asks the user to reconnect when the refresh token is dead', async () => {
    google.state.tokenError = 'invalid_grant';
    const res = await call({ action: 'list', timeMin: 'a', timeMax: 'b' });
    expect(res.body.error).toBe('reconnect_required');
    expect(tokens.has('u1')).toBe(false);
    expect((await call({ action: 'status' })).body).toEqual({ status: 'disconnected' });
  });

  it('reports not_connected without a token', async () => {
    tokens.clear();
    const res = await call({ action: 'upsert', event: { summary: 'x', start: {}, end: {} } });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('not_connected');
  });

  it('creates, updates and deletes events', async () => {
    const event = {
      summary: 'Dentist',
      start: { dateTime: '2026-10-23T16:00:00+05:00', timeZone: 'Asia/Karachi' },
      end: { dateTime: '2026-10-23T17:00:00+05:00', timeZone: 'Asia/Karachi' },
      extendedProperties: { private: { dayflow: '1', dayflowTaskId: 't1' } },
    };
    const created = await call({ action: 'upsert', event });
    const id = created.body.eventId;
    expect(google.state.events.get(id)?.summary).toBe('Dentist');

    const updated = await call({ action: 'upsert', eventId: id, event: { ...event, summary: 'Dentist (moved)' } });
    expect(updated.body.eventId).toBe(id);
    expect(google.state.events.get(id)?.summary).toBe('Dentist (moved)');

    expect((await call({ action: 'delete', eventId: id })).body).toEqual({ ok: true });
    expect(google.state.events.size).toBe(0);
    // deleting again (already gone in Google) is not an error
    expect((await call({ action: 'delete', eventId: id })).status).toBe(200);
  });

  it('creates the event under the app’s chosen id when it does not exist yet', async () => {
    const res = await call({ action: 'upsert', eventId: 'df0123abcd', event: { summary: 'Gym', start: {}, end: {} } });
    expect(res.body.eventId).toBe('df0123abcd');
    expect(google.state.events.get('df0123abcd')?.status).toBe('confirmed');
  });

  it('updates instead of duplicating when a second device adds the same task', async () => {
    const event = { summary: 'Gym', start: {}, end: {} };
    await call({ action: 'upsert', eventId: 'df0123abcd', event });
    await call({ action: 'upsert', eventId: 'df0123abcd', event: { ...event, summary: 'Gym 7pm' } });
    expect(google.state.events.size).toBe(1);
    expect(google.state.events.get('df0123abcd')?.summary).toBe('Gym 7pm');
  });

  it('revokes and forgets the token on disconnect', async () => {
    await call({ action: 'disconnect' });
    expect(google.calls.some((c) => c.url.includes('/revoke'))).toBe(true);
    expect(tokens.has('u1')).toBe(false);
  });
});

describe('normalizeEvent', () => {
  it('maps timed, all-day, free, declined and Dayflow events', () => {
    expect(
      normalizeEvent({ id: 'a', summary: 'Standup', start: { dateTime: '2026-10-19T09:00:00Z' }, end: { dateTime: '2026-10-19T09:15:00Z' } }),
    ).toMatchObject({ id: 'a', title: 'Standup', allDay: false, start: Date.UTC(2026, 9, 19, 9), transparent: false });
    expect(normalizeEvent({ id: 'b', start: { date: '2026-10-19' }, end: { date: '2026-10-20' } })).toMatchObject({ allDay: true, title: 'Busy' });
    expect(normalizeEvent({ id: 'c', transparency: 'transparent', start: { dateTime: 'x' }, end: { dateTime: 'x' } })?.transparent).toBe(true);
    expect(
      normalizeEvent({ id: 'd', attendees: [{ self: true, responseStatus: 'declined' }], start: { dateTime: 'x' }, end: { dateTime: 'x' } })?.declined,
    ).toBe(true);
    expect(
      normalizeEvent({ id: 'e', extendedProperties: { private: { dayflow: '1', dayflowTaskId: 't9' } }, start: { dateTime: 'x' }, end: { dateTime: 'x' } }),
    ).toMatchObject({ fromDayflow: true, taskId: 't9' });
    expect(normalizeEvent({ id: 'f', status: 'cancelled', start: { dateTime: 'x' }, end: { dateTime: 'x' } })).toBeNull();
  });
});
