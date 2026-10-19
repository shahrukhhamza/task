# Notifications on your phone (Supabase + Vercel)

Dayflow can push to your phone while the app is closed, like any to-do app. Your phone only
needs internet. This guide takes about 15 minutes and is free.

## What you will get

| Notification | When |
|---|---|
| **Up next** | A few minutes before each planned task or appointment (you choose how many) |
| **Morning plan** | At the time you pick (default 8:00): how many things today, what comes first, what is due |
| **Deadline alert** | An hour before a deadline that has a set time ("due Friday 5pm") |
| **Evening wrap-up** | At the time you pick (default 8:30 pm): what you finished, what is left, how tomorrow starts |

All of them are switched on or off under **Settings → Notifications**.

## How it works

1. Your phone registers with its push service (Google for Android, Apple for iPhone) and gives
   Dayflow a private address for it. Dayflow stores that address in Supabase.
2. Every minute Supabase (`pg_cron`) wakes the `send-reminders` function. It looks at each
   user's tasks and, when something is due, sends an encrypted push to the phone.
3. The phone shows it, even if Dayflow is closed.

## Steps

You need the Supabase project and the Vercel deploy from [SETUP.md](SETUP.md). If you have
not done those yet, do steps 1, 5, 6, 7 and 9 there first. Then:

### 1. Generate your push keys

```bash
npm run vapid
```

It prints a **public** and a **private** key. Keep the terminal open.

### 2. Put the keys where they belong

| Where | Name | Value |
|---|---|---|
| Vercel → Project → Settings → Environment Variables | `VITE_VAPID_PUBLIC_KEY` | the public key |
| `supabase/functions/.env` | `VAPID_PUBLIC_KEY` | the same public key |
| `supabase/functions/.env` | `VAPID_PRIVATE_KEY` | the private key (never in Vercel, never in git) |
| `supabase/functions/.env` | `VAPID_SUBJECT` | `mailto:` plus your email |

Vercel also needs `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. After adding variables,
open **Deployments → ⋯ → Redeploy**, because Vite bakes them into the build.

### 3. Update the database and deploy the functions

In the Supabase **SQL Editor**, run `supabase/migrations/0003_push_prefs.sql` once (it adds the
notification settings). Then:

```bash
npx supabase secrets set --env-file supabase/functions/.env
npx supabase functions deploy send-reminders --no-verify-jwt
npx supabase functions deploy push-test
```

Make sure `supabase/migrations/0002_cron.sql` has been run as described in SETUP.md step 7;
that is what wakes the function every minute.

### 4. Turn it on, on your phone

1. Open your Vercel URL in **Chrome** (Android) or **Safari** (iPhone).
2. **iPhone only:** tap Share → **Add to Home Screen**, then open Dayflow from the new icon.
   Apple only allows web notifications for apps added to the Home Screen (iOS 16.4 or newer).
   **Android:** Chrome menu → **Install app** (optional, but it makes delivery more reliable).
3. **Settings → Account:** sign in with Google.
4. **Settings → Notifications → Turn notifications on** and tap **Allow**.
5. Tap **Send a test to this phone**. A notification should arrive within seconds.

## If nothing arrives

| Symptom | Fix |
|---|---|
| The page says push is not configured | `VITE_VAPID_PUBLIC_KEY` is missing in Vercel, or you did not redeploy after adding it. |
| "Notifications are blocked" | Phone settings → Apps/Safari → Dayflow → Notifications → allow. |
| Test says "no device" | Turn notifications off and on again while signed in. |
| Test says "VAPID keys are missing" | Run the `secrets set` command in step 3, then redeploy `push-test`. |
| Test works, scheduled ones never come | The cron job is missing. Check **Integrations → Cron** for `dayflow-reminders`, and the two Vault secrets from SETUP.md step 7. |
| Works for a day, then stops on Android | Battery saver is freezing the browser. Phone settings → Battery → Dayflow (or Chrome) → **Unrestricted**. |
| iPhone: no permission prompt | Dayflow must be opened from the Home Screen icon, not from Safari. |
| Supabase paused the project | Free projects pause after 7 days without activity. Open the dashboard and click **Restore**. |

Your tasks and settings stay on your phone first; Supabase only needs the task times and your
notification settings to know when to ping you. You can turn notifications off at any time in
Settings, which also removes this phone from the server.
