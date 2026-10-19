// Deno entry point for the push-test Edge Function.
// Secrets: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (the same ones send-reminders uses).

import { createClient } from 'npm:@supabase/supabase-js@2';
import { bearer } from '../_shared/http.ts';
import { createPushTestHandler } from './handler.ts';

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
});

Deno.serve(
  createPushTestHandler({
    now: () => Date.now(),
    fetch,
    vapid: {
      publicKey: Deno.env.get('VAPID_PUBLIC_KEY') ?? '',
      privateKey: Deno.env.get('VAPID_PRIVATE_KEY') ?? '',
      subject: Deno.env.get('VAPID_SUBJECT') ?? 'mailto:admin@example.com',
    },
    async authenticate(req) {
      const jwt = bearer(req);
      if (!jwt) return null;
      const { data } = await admin.auth.getUser(jwt);
      return data.user?.id ?? null;
    },
    async listSubscriptions(userId) {
      const { data } = await admin.from('push_subscriptions').select('endpoint, p256dh, auth').eq('user_id', userId);
      return (data ?? []).map((s) => ({ endpoint: s.endpoint, p256dh: s.p256dh, auth: s.auth }));
    },
    async removeSubscription(endpoint) {
      await admin.from('push_subscriptions').delete().eq('endpoint', endpoint);
    },
  }),
);
