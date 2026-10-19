// "Send me a test notification": pushes to the signed-in user's own devices so they can
// confirm the whole chain (permission, subscription, VAPID keys, the push service) works.

import { corsHeaders, json } from '../_shared/http.ts';
import { sendPush, type PushSubscriptionKeys, type VapidKeys } from '../_shared/webpush.ts';

export interface PushTestDeps {
  now(): number;
  vapid: VapidKeys;
  fetch: typeof fetch;
  authenticate(req: Request): Promise<string | null>;
  listSubscriptions(userId: string): Promise<PushSubscriptionKeys[]>;
  removeSubscription(endpoint: string): Promise<void>;
}

/** One test per user every few seconds is plenty and keeps this from being a spam button. */
const COOLDOWN_MS = 5_000;

export function createPushTestHandler(deps: PushTestDeps) {
  const last = new Map<string, number>();

  return async function handle(req: Request): Promise<Response> {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
    if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
    if (!deps.vapid.publicKey || !deps.vapid.privateKey) {
      return json({ error: 'not_configured', message: 'Push isn’t set up on the server yet (VAPID keys are missing).' }, 503);
    }

    const userId = await deps.authenticate(req);
    if (!userId) return json({ error: 'unauthorized' }, 401);

    const now = deps.now();
    if (now - (last.get(userId) ?? 0) < COOLDOWN_MS) return json({ error: 'rate_limited', message: 'Wait a few seconds before testing again.' }, 429);
    last.set(userId, now);

    const subscriptions = await deps.listSubscriptions(userId);
    if (!subscriptions.length) {
      return json({ error: 'no_device', message: 'This phone isn’t registered for notifications yet. Turn reminders on first.' }, 409);
    }

    const result = { sent: 0, gone: 0, failed: 0, devices: subscriptions.length };
    for (const sub of subscriptions) {
      try {
        const { outcome } = await sendPush(
          deps.fetch,
          sub,
          { title: 'Dayflow notifications are on', body: 'You’ll get reminders, your morning plan and deadline alerts here, even when the app is closed.', tag: 'dayflow-test', url: '/' },
          deps.vapid,
        );
        result[outcome]++;
        if (outcome === 'gone') await deps.removeSubscription(sub.endpoint);
      } catch {
        result.failed++;
      }
    }
    return json(result);
  };
}
