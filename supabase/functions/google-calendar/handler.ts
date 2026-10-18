// Proxy between the app and the Google Calendar API.
//
// Why a server: refreshing a Google access token needs the OAuth client secret, which
// must never ship to the browser. The refresh token is stored in `google_tokens`, a
// table only the service role can read.

import { corsHeaders, json } from '../_shared/http.ts';

export interface GoogleDeps {
  fetch: typeof fetch;
  clientId: string;
  clientSecret: string;
  /** Returns the signed-in user's id, or null if the request isn't authenticated. */
  authenticate(req: Request): Promise<string | null>;
  getRefreshToken(userId: string): Promise<string | null>;
  saveRefreshToken(userId: string, token: string): Promise<void>;
  deleteRefreshToken(userId: string): Promise<void>;
  now?: () => number;
}

/** A Google event reduced to what the planner needs. */
export interface CalendarEvent {
  id: string;
  title: string;
  start: number;
  end: number;
  allDay: boolean;
  /** Marked "free" in Google, so it shouldn't block time. */
  transparent: boolean;
  declined: boolean;
  /** Created by Dayflow itself (from a task). */
  fromDayflow: boolean;
  taskId?: string;
}

export interface EventInput {
  summary: string;
  description?: string;
  start: { dateTime?: string; date?: string; timeZone?: string };
  end: { dateTime?: string; date?: string; timeZone?: string };
  recurrence?: string[];
  extendedProperties?: { private?: Record<string, string> };
}

type Action =
  | { action: 'store-token'; refreshToken: string }
  | { action: 'status' }
  | { action: 'disconnect' }
  | { action: 'list'; timeMin: string; timeMax: string }
  | { action: 'upsert'; eventId?: string; event: EventInput }
  | { action: 'delete'; eventId: string };

const API = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';

class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message?: string,
  ) {
    super(message ?? code);
  }
}

interface GoogleEventRaw {
  id: string;
  status?: string;
  summary?: string;
  transparency?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  attendees?: Array<{ self?: boolean; responseStatus?: string }>;
  extendedProperties?: { private?: Record<string, string> };
}

export function normalizeEvent(raw: GoogleEventRaw): CalendarEvent | null {
  if (raw.status === 'cancelled' || !raw.start || !raw.end) return null;
  const allDay = !raw.start.dateTime;
  const start = new Date(raw.start.dateTime ?? `${raw.start.date}T00:00:00Z`).getTime();
  const end = new Date(raw.end.dateTime ?? `${raw.end.date}T00:00:00Z`).getTime();
  const priv = raw.extendedProperties?.private ?? {};
  return {
    id: raw.id,
    title: raw.summary?.trim() || 'Busy',
    start,
    end,
    allDay,
    transparent: raw.transparency === 'transparent',
    declined: !!raw.attendees?.some((a) => a.self && a.responseStatus === 'declined'),
    fromDayflow: priv.dayflow === '1',
    taskId: priv.dayflowTaskId,
  };
}

export function createHandler(deps: GoogleDeps, cache = new Map<string, { token: string; expires: number }>()) {
  const now = deps.now ?? Date.now;

  async function accessToken(userId: string, force = false): Promise<string> {
    const cached = cache.get(userId);
    if (!force && cached && cached.expires > now() + 60_000) return cached.token;

    const refresh = await deps.getRefreshToken(userId);
    if (!refresh) throw new HttpError(409, 'not_connected', 'Google Calendar is not connected.');

    const res = await deps.fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: deps.clientId,
        client_secret: deps.clientSecret,
        refresh_token: refresh,
        grant_type: 'refresh_token',
      }),
    });
    const body = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: string };
    if (!res.ok || !body.access_token) {
      // invalid_grant: revoked, or expired (7 days while the Google app is in "Testing")
      if (body.error === 'invalid_grant') {
        await deps.deleteRefreshToken(userId);
        cache.delete(userId);
        throw new HttpError(401, 'reconnect_required', 'Google access expired. Please reconnect Google Calendar.');
      }
      throw new HttpError(502, 'google_error', `Token refresh failed: ${body.error ?? res.status}`);
    }
    cache.set(userId, { token: body.access_token, expires: now() + (body.expires_in ?? 3600) * 1000 });
    return body.access_token;
  }

  /** Calls the Calendar API, refreshing the access token once if Google rejects it. */
  async function google(userId: string, url: string, init: RequestInit = {}): Promise<Response> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const token = await accessToken(userId, attempt > 0);
      const res = await deps.fetch(url, {
        ...init,
        headers: { ...(init.headers ?? {}), Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      });
      if (res.status !== 401) return res;
    }
    throw new HttpError(401, 'reconnect_required', 'Google rejected the stored access. Please reconnect.');
  }

  async function list(userId: string, timeMin: string, timeMax: string): Promise<CalendarEvent[]> {
    const events: CalendarEvent[] = [];
    let pageToken: string | undefined;
    for (let page = 0; page < 5; page++) {
      const params = new URLSearchParams({ timeMin, timeMax, singleEvents: 'true', orderBy: 'startTime', maxResults: '250' });
      if (pageToken) params.set('pageToken', pageToken);
      const res = await google(userId, `${API}?${params}`);
      if (!res.ok) throw new HttpError(502, 'google_error', `List failed (${res.status})`);
      const body = (await res.json()) as { items?: GoogleEventRaw[]; nextPageToken?: string };
      for (const raw of body.items ?? []) {
        const event = normalizeEvent(raw);
        if (event) events.push(event);
      }
      pageToken = body.nextPageToken;
      if (!pageToken) break;
    }
    return events;
  }

  /**
   * The app passes a deterministic event id derived from the task id, so two devices
   * adding the same task end up updating one event instead of creating duplicates.
   */
  async function upsert(userId: string, event: EventInput, eventId?: string): Promise<string> {
    const body = { ...event, status: 'confirmed' }; // also restores an event cancelled in Google
    if (eventId) {
      const res = await google(userId, `${API}/${encodeURIComponent(eventId)}`, { method: 'PUT', body: JSON.stringify(body) });
      if (res.ok) return ((await res.json()) as { id: string }).id;
      if (res.status !== 404 && res.status !== 410) throw new HttpError(502, 'google_error', `Update failed (${res.status})`);

      const created = await google(userId, API, { method: 'POST', body: JSON.stringify({ ...body, id: eventId }) });
      if (created.ok) return ((await created.json()) as { id: string }).id;
      // 409: the id is taken by an event we can't update; fall back to a fresh id
      if (created.status !== 409) throw new HttpError(502, 'google_error', `Create failed (${created.status})`);
    }
    const res = await google(userId, API, { method: 'POST', body: JSON.stringify(body) });
    if (!res.ok) throw new HttpError(502, 'google_error', `Create failed (${res.status})`);
    return ((await res.json()) as { id: string }).id;
  }

  async function remove(userId: string, eventId: string): Promise<void> {
    const res = await google(userId, `${API}/${encodeURIComponent(eventId)}`, { method: 'DELETE' });
    if (!res.ok && res.status !== 404 && res.status !== 410) throw new HttpError(502, 'google_error', `Delete failed (${res.status})`);
  }

  return async function handle(req: Request): Promise<Response> {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
    if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

    try {
      const userId = await deps.authenticate(req);
      if (!userId) return json({ error: 'unauthorized' }, 401);
      const body = (await req.json().catch(() => null)) as Action | null;
      if (!body || typeof body !== 'object') return json({ error: 'bad_request' }, 400);

      switch (body.action) {
        case 'store-token':
          if (!body.refreshToken) return json({ error: 'bad_request' }, 400);
          await deps.saveRefreshToken(userId, body.refreshToken);
          cache.delete(userId);
          return json({ ok: true });

        case 'status': {
          if (!(await deps.getRefreshToken(userId))) return json({ status: 'disconnected' });
          await accessToken(userId);
          return json({ status: 'connected' });
        }

        case 'disconnect': {
          const token = await deps.getRefreshToken(userId);
          if (token) {
            await deps
              .fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, { method: 'POST' })
              .catch(() => undefined);
          }
          await deps.deleteRefreshToken(userId);
          cache.delete(userId);
          return json({ ok: true });
        }

        case 'list':
          return json({ events: await list(userId, body.timeMin, body.timeMax) });

        case 'upsert':
          return json({ eventId: await upsert(userId, body.event, body.eventId) });

        case 'delete':
          await remove(userId, body.eventId);
          return json({ ok: true });

        default:
          return json({ error: 'unknown_action' }, 400);
      }
    } catch (err) {
      if (err instanceof HttpError) {
        // reconnect is reported as a normal status so the app can show its prompt
        if (err.code === 'reconnect_required') return json({ error: err.code, message: err.message }, 200);
        return json({ error: err.code, message: err.message }, err.status);
      }
      return json({ error: 'internal', message: err instanceof Error ? err.message : String(err) }, 500);
    }
  };
}
