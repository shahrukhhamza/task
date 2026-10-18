import type { Session } from '@supabase/supabase-js';
import { useCloud } from '../../store/cloud';
import { CalendarError, importGoogleEvents, syncCalendarLinks, type Invoke } from '../calendar/googleSync';
import { replanAll } from '../db/actions';
import { db, ensureProfile } from '../db/schema';
import { syncOnce } from '../sync/engine';
import { MAPPERS } from '../sync/mappers';
import { supabaseRemote } from '../sync/supabaseRemote';
import { callFunction, cloudConfigured, FunctionError, getSupabase } from './client';
import { enablePush } from './push';

const SYNC_DEBOUNCE_MS = 1500;
const SYNC_INTERVAL_MS = 60_000;
/** Google events are re-imported at most this often unless forced. */
const IMPORT_EVERY_MS = 10 * 60_000;
const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.events';

let userId: string | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
let running = false;
let again = false;
let started = false;

const state = () => useCloud.getState();

/** Calendar calls go through the google-calendar Edge Function. */
const invokeGoogle: Invoke = async (body) => {
  try {
    return await callFunction('google-calendar', body);
  } catch (err) {
    if (err instanceof FunctionError) {
      const code = (['reconnect_required', 'not_connected', 'not_configured', 'unauthorized', 'network'] as const).find((c) => c === err.code) ?? 'google_error';
      throw new CalendarError(code, err.message);
    }
    throw err;
  }
};

function handleCalendarError(err: unknown) {
  if (err instanceof CalendarError) {
    if (err.code === 'reconnect_required') state().patch({ google: 'reconnect', googleError: err.message });
    else if (err.code === 'not_connected') state().patch({ google: 'disconnected' });
    else state().patch({ google: 'error', googleError: err.message });
  } else {
    state().patch({ google: 'error', googleError: err instanceof Error ? err.message : String(err) });
  }
}

// ------------------------------------------------------------------ sync loop

/** Asks for a sync soon. Many quick edits collapse into one round trip. */
export function requestSync(delay = SYNC_DEBOUNCE_MS): void {
  if (!userId) return;
  clearTimeout(timer);
  timer = setTimeout(() => void runSync(), delay);
}

async function runSync(): Promise<void> {
  if (!userId) return;
  if (running) {
    again = true;
    return;
  }
  if (!navigator.onLine) {
    state().patch({ syncStatus: 'offline' });
    return;
  }
  const supabase = await getSupabase();
  if (!supabase) return;

  running = true;
  state().patch({ syncStatus: 'syncing', syncError: undefined });
  try {
    await syncOnce(db, supabaseRemote(supabase), userId);
    state().patch({ syncStatus: 'idle', lastSyncedAt: Date.now() });
    if (state().google === 'connected') await runCalendar(false);
  } catch (err) {
    state().patch({ syncStatus: 'error', syncError: err instanceof Error ? err.message : String(err) });
  } finally {
    running = false;
    if (again) {
      again = false;
      requestSync();
    }
  }
}

/** Imports Google events (throttled) and pushes flagged tasks to Google. */
async function runCalendar(forceImport: boolean): Promise<void> {
  try {
    const { timezone } = await ensureProfile();
    const last = state().lastImportAt ?? 0;
    if (forceImport || Date.now() - last > IMPORT_EVERY_MS) {
      const changes = await importGoogleEvents(invokeGoogle, db, Date.now(), timezone);
      state().patch({ lastImportAt: Date.now() });
      if (changes.added || changes.updated || changes.removed) await replanAll();
    }
    await syncCalendarLinks(invokeGoogle, db, timezone);
  } catch (err) {
    handleCalendarError(err);
  }
}

// ------------------------------------------------------------------ session

async function applySession(session: Session | null): Promise<void> {
  if (!session) {
    userId = null;
    state().patch({ user: null, ready: true, google: 'unknown' });
    return;
  }
  userId = session.user.id;
  const meta = session.user.user_metadata ?? {};
  state().patch({
    ready: true,
    user: {
      id: session.user.id,
      email: session.user.email ?? '',
      name: (meta.full_name as string) ?? (meta.name as string) ?? undefined,
      avatarUrl: (meta.avatar_url as string) ?? undefined,
    },
  });
  requestSync(0);
  void refreshGoogleStatus();
  // a device that already has reminders on also gets them while the app is closed
  const profile = await ensureProfile();
  if (profile.remindersEnabled && 'Notification' in window && Notification.permission === 'granted') {
    void enablePush().catch(() => undefined);
  }
}

export async function refreshGoogleStatus(): Promise<void> {
  try {
    const { status } = await invokeGoogle<{ status: 'connected' | 'disconnected' }>({ action: 'status' });
    state().patch({ google: status, googleError: undefined });
    if (status === 'connected') requestSync(0);
  } catch (err) {
    handleCalendarError(err);
  }
}

/** Wires up auth, sync triggers and periodic sync. Safe to call more than once. */
export async function initCloud(): Promise<void> {
  if (started || !cloudConfigured) return;
  started = true;
  const supabase = await getSupabase();
  if (!supabase) return;

  // any local change to a synced table schedules a sync
  for (const mapper of MAPPERS) {
    const table = db.table(mapper.local);
    table.hook('creating', () => requestSync());
    table.hook('updating', () => requestSync());
    table.hook('deleting', () => requestSync());
  }
  window.addEventListener('online', () => requestSync(0));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') requestSync(0);
  });
  setInterval(() => requestSync(0), SYNC_INTERVAL_MS);

  supabase.auth.onAuthStateChange((event, session) => {
    // Google only hands out a refresh token right after consent; store it server-side at once
    if (event === 'SIGNED_IN' && session?.provider_refresh_token) {
      void invokeGoogle({ action: 'store-token', refreshToken: session.provider_refresh_token })
        .then(() => state().patch({ google: 'connected', googleError: undefined }))
        .catch(handleCalendarError);
    }
    // supabase-js warns against awaiting other calls inside this callback
    setTimeout(() => void applySession(session), 0);
  });
  const { data } = await supabase.auth.getSession();
  await applySession(data.session);
}

// ------------------------------------------------------------------ actions for the UI

/** Google sign-in with calendar access. Also used to reconnect after access expires. */
export async function signInWithGoogle(): Promise<void> {
  const supabase = await getSupabase();
  if (!supabase) throw new FunctionError('not_configured');
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: `${window.location.origin}/settings`,
      scopes: CALENDAR_SCOPE,
      // offline + consent makes Google return a refresh token every time
      queryParams: { access_type: 'offline', prompt: 'consent' },
    },
  });
  if (error) throw error;
}

export async function signOut(): Promise<void> {
  const supabase = await getSupabase();
  await supabase?.auth.signOut();
  userId = null;
  state().patch({ user: null, google: 'unknown', syncStatus: 'idle', lastSyncedAt: undefined });
}

export async function syncNow(): Promise<void> {
  clearTimeout(timer);
  await runSync();
}

export async function importCalendarNow(): Promise<void> {
  await runCalendar(true);
}

/** Deletes every row this user owns on the server (row level security limits it to them). */
export async function deleteCloudData(): Promise<void> {
  const supabase = await getSupabase();
  if (!supabase || !userId) return;
  for (const table of ['tasks', 'task_events', 'fixed_events', 'habits', 'habit_logs', 'checkins', 'calendar_links']) {
    const { error } = await supabase.from(table).delete().eq('user_id', userId);
    if (error) throw new Error(`${table}: ${error.message}`);
  }
}

export async function disconnectGoogle(): Promise<void> {
  try {
    await invokeGoogle({ action: 'disconnect' });
    state().patch({ google: 'disconnected' });
  } catch (err) {
    handleCalendarError(err);
  }
}
