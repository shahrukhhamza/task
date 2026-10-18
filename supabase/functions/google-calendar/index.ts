// Deno entry point for the google-calendar Edge Function.
// Secrets (set with `supabase secrets set`): GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET.
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by Supabase automatically.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { bearer } from '../_shared/http.ts';
import { createHandler } from './handler.ts';

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
});

Deno.serve(
  createHandler({
    fetch,
    clientId: Deno.env.get('GOOGLE_CLIENT_ID') ?? '',
    clientSecret: Deno.env.get('GOOGLE_CLIENT_SECRET') ?? '',

    async authenticate(req) {
      const jwt = bearer(req);
      if (!jwt) return null;
      const { data } = await admin.auth.getUser(jwt);
      return data.user?.id ?? null;
    },

    async getRefreshToken(userId) {
      const { data } = await admin.from('google_tokens').select('refresh_token').eq('user_id', userId).maybeSingle();
      return data?.refresh_token ?? null;
    },

    async saveRefreshToken(userId, token) {
      const { error } = await admin
        .from('google_tokens')
        .upsert({ user_id: userId, refresh_token: token, updated_at: new Date().toISOString() });
      if (error) throw error;
    },

    async deleteRefreshToken(userId) {
      await admin.from('google_tokens').delete().eq('user_id', userId);
    },
  }),
);
