import type { SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

/** False until the Supabase keys are added; the app is then fully local. */
export const cloudConfigured = Boolean(url && anonKey);

let client: Promise<SupabaseClient> | null = null;

/** Loads supabase-js only when cloud features are actually used, keeping the offline bundle small. */
export function getSupabase(): Promise<SupabaseClient> | null {
  if (!cloudConfigured) return null;
  client ??= import('@supabase/supabase-js').then(({ createClient }) =>
    createClient(url as string, anonKey as string, {
      auth: { flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    }),
  );
  return client;
}

/** Calls an Edge Function and turns every failure into a `{ code, message }` error. */
export class FunctionError extends Error {
  constructor(
    public code: string,
    message?: string,
  ) {
    super(message ?? code);
  }
}

export async function callFunction<T>(name: string, body: Record<string, unknown>): Promise<T> {
  const pending = getSupabase();
  if (!pending) throw new FunctionError('not_configured', 'Cloud features are not set up yet.');
  const supabase = await pending;
  const { data, error } = await supabase.functions.invoke(name, { body });

  if (error) {
    const context = (error as { context?: Response }).context;
    let payload: { error?: string; message?: string } | undefined;
    try {
      payload = context ? await context.json() : undefined;
    } catch {
      payload = undefined;
    }
    if (payload?.error) throw new FunctionError(payload.error, payload.message);
    if (error.name === 'FunctionsFetchError' || error.name === 'FunctionsRelayError') {
      throw new FunctionError('network', 'Couldn’t reach the server. Check your connection.');
    }
    throw new FunctionError('server_error', error.message);
  }
  const result = data as T & { error?: string; message?: string };
  if (result && typeof result === 'object' && result.error) throw new FunctionError(result.error, result.message);
  return result;
}
