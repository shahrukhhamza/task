# Setting up the cloud features (all free)

Dayflow works fully offline with no setup. This guide switches on sign-in, sync across
devices, Google Calendar, nightly emails and closed-app reminders. Every service below
has a free tier that needs **no credit card**.

Total time: about 45 minutes. Do the steps in order; each one names exactly where its
values go.

| You'll create | Free tier | Used for |
|---|---|---|
| Supabase project | 2 projects, 500 MB DB, 500k function calls/month | auth, database, sync, scheduled jobs |
| Google Cloud OAuth client | free | Google sign-in, Calendar |
| Resend account | 3,000 emails/month, 100/day | nightly summary email |
| VAPID key pair | generated locally | push reminders |
| Vercel or Cloudflare Pages | free hobby tier | hosting the app |
| Gemini API key (optional) | free tier, limits set by Google | the smart assistant |

You'll need Node 20+ and this repo cloned. All commands run from the repo root.

---

## 0. Smart assistant (Gemini), the quickest win

This one needs no Supabase at all and takes about a minute:

1. Open <https://aistudio.google.com/apikey> and sign in with your Google account.
2. Click **Create API key** (free, no card). Copy it.
3. In Dayflow: **Settings → Smart assistant**, paste the key, press **Connect**.

Dayflow checks the key, picks the best free Gemini *Flash* model it can use, and switches on:
understanding anything you type or say (any language, including Urdu and Roman Urdu),
"Break it down" for big tasks, a short daily brief on Today, and a deeper weekly look on Progress.

The key is stored on that device only and never synced, so repeat this on each device, or use
the server option in step 6. Free-tier limits are set by Google and change from time to time; check
yours at <https://aistudio.google.com/rate-limit>. When the limit is reached Dayflow falls back to
its built-in parser automatically. Note that on the free tier Google may use prompts to improve its
products.

## 1. Supabase project

1. Go to <https://supabase.com>, click **Start your project**, sign in with GitHub.
2. **New project**: name `dayflow`, set a strong database password (save it in a password
   manager), pick the region nearest you (for Pakistan: *South Asia (Mumbai)*), plan **Free**.
   Wait about two minutes for it to start.
3. **Project Settings → API** (or **API Keys**). Copy:
   - **Project URL** → `VITE_SUPABASE_URL`
   - **anon public** key (newer dashboards: **Publishable key**) → `VITE_SUPABASE_ANON_KEY`

   Put both in a new file `.env.local` in the repo root (copy `.env.example`).
   Never use the `service_role`/secret key in the app.
4. Note your **project ref**: the `xxxx` in `https://xxxx.supabase.co`.
5. Create the tables. Either:
   - **Dashboard**: SQL Editor → New query → paste all of `supabase/migrations/0001_init.sql` → **Run**, or
   - **CLI**:
     ```bash
     npx supabase login
     npx supabase link --project-ref <your-ref>
     npx supabase db push        # applies 0001 and 0002; run this after step 6 instead if you use the CLI
     ```
   Also run `0003_push_prefs.sql` the same way (the notification settings). Don't run
   `0002_cron.sql` yet; it needs the secrets from step 6.

## 2. Google sign-in and Calendar (OAuth client ID)

1. Open <https://console.cloud.google.com>, sign in, **Select a project → New project**,
   name it `Dayflow`, **Create**, then select it.
2. **APIs & Services → Library** → search **Google Calendar API** → **Enable**.
3. **Google Auth Platform** (or **OAuth consent screen**) → **Get started**:
   - App name `Dayflow`, user support email = yours.
   - Audience: **External**.
   - Contact email = yours → **Create**.
4. **Audience → Test users → Add users**: add your own Gmail address (and anyone else who
   will use it, up to 100).
5. **Data access → Add or remove scopes**: add `.../auth/calendar.events` (plus the default
   `openid`, `email`, `profile`) → **Update → Save**.
6. **Clients → Create client** (or **Credentials → Create credentials → OAuth client ID**):
   - Application type: **Web application**, name `Dayflow web`.
   - **Authorized JavaScript origins**: `http://localhost:5173` (add your deployed URL later).
   - **Authorized redirect URIs**: `https://<your-ref>.supabase.co/auth/v1/callback`
   - **Create**, then copy the **Client ID** and **Client secret**.
7. Back in Supabase: **Authentication → Sign In / Providers → Google** → enable, paste the
   Client ID and Client secret → **Save**.
8. Supabase **Authentication → URL Configuration**:
   - Site URL: `http://localhost:5173` (change to the deployed URL in step 7)
   - Redirect URLs: add `http://localhost:5173/**`

> **Testing mode limit:** while the Google app is in "Testing", Google expires the refresh
> token after 7 days. Dayflow detects this and shows a "Reconnect Google" prompt; one click
> fixes it. Publishing the app removes the limit but requires Google's verification review
> because Calendar is a sensitive scope (free, takes a few days).

## 3. Resend (email)

1. Sign up at <https://resend.com> (free, no card).
2. **API Keys → Create API key**, permission **Sending access** → copy it (`re_...`).
3. Without your own domain, Resend sends only **from `onboarding@resend.dev` to the email you
   signed up with**. That's enough for personal use: use that address as the recipient in
   Dayflow's settings. To email anyone else, **Domains → Add domain**, add the DNS records it
   shows, then set `EMAIL_FROM` to something like `Dayflow <summary@yourdomain.com>`.

## 4. Push reminder keys (VAPID)

```bash
npm run vapid
```

Copy the **Public Key** to both `VITE_VAPID_PUBLIC_KEY` (in `.env.local`) and
`VAPID_PUBLIC_KEY`, and the **Private Key** to `VAPID_PRIVATE_KEY` (function secrets, next
step). The private key must never go in `.env.local`.

## 5. Two random secrets

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"   # CRON_SECRET
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"   # UNSUBSCRIBE_SECRET
```

## 6. Edge Function secrets and deploy

1. Copy `supabase/functions/.env.example` to `supabase/functions/.env` (git-ignored) and
   fill in everything from steps 2–5. `APP_URL` is `http://localhost:5173` for now.
2. Push the secrets and deploy the functions:
   ```bash
   npx supabase login                       # if you haven't already
   npx supabase link --project-ref <your-ref>
   npx supabase secrets set --env-file supabase/functions/.env
   npx supabase functions deploy google-calendar
   npx supabase functions deploy daily-summary --no-verify-jwt
   npx supabase functions deploy send-reminders --no-verify-jwt
   npx supabase functions deploy push-test
   npx supabase functions deploy ai            # only if you set GEMINI_API_KEY
   ```
   With `GEMINI_API_KEY` set on the server, signed-in users get the smart assistant without
   pasting their own key (they still switch it on in Settings → Smart assistant).
   (`--no-verify-jwt` is required: the scheduler and email unsubscribe links call those two
   without a user token; they check `CRON_SECRET` / a signed link instead.)

## 7. Schedule the jobs (pg_cron)

In the Supabase **SQL Editor**, store two secrets in Vault (replace the values):

```sql
select vault.create_secret('https://<your-ref>.supabase.co', 'project_url');
select vault.create_secret('<your CRON_SECRET>', 'cron_secret');
```

Then paste and run all of `supabase/migrations/0002_cron.sql`. If it complains about an
extension, enable **pg_cron** and **pg_net** under **Database → Extensions** and run it again.
Check it worked under **Integrations → Cron**: you should see `dayflow-daily-summary`
(every 15 min), `dayflow-reminders` (every minute) and `dayflow-net-cleanup`.

## 8. Try it locally

```bash
npm run dev
```

Open <http://localhost:5173/settings> → **Sign in with Google** → approve the calendar access.
Then check:
- **Account & sync** shows "Up to date".
- **Google Calendar** shows "Connected"; your events appear as fixed blocks on Today.
- **Nightly summary email → Send test email now** delivers to your inbox.
- **Notifications → Turn notifications on → Send a test** shows a notification. For
  notifications on your phone, follow [PHONE_PUSH.md](PHONE_PUSH.md).

## 9. Deploy the app

**Vercel**: <https://vercel.com> → sign in with GitHub → **Add New → Project** → import this
repo → Framework **Vite** → add the three `VITE_*` environment variables → **Deploy**.

**Cloudflare Pages**: dashboard → **Workers & Pages → Create → Pages → Connect to Git** →
build command `npm run build`, output directory `dist` → add the `VITE_*` variables → **Save and deploy**.

Then point everything at the new URL (say `https://dayflow-you.vercel.app`):
1. Google Cloud → your OAuth client → **Authorized JavaScript origins**: add the URL.
2. Supabase → Authentication → URL Configuration: Site URL = the URL; add `https://dayflow-you.vercel.app/**` to Redirect URLs.
3. Update `APP_URL` in `supabase/functions/.env` and run `npx supabase secrets set --env-file supabase/functions/.env` again.

## Troubleshooting

| Symptom | Fix |
|---|---|
| "redirect_uri_mismatch" on Google sign-in | The redirect URI in step 2.6 must be exactly `https://<ref>.supabase.co/auth/v1/callback`. |
| "Access blocked: app has not completed verification" | Add your Gmail as a **test user** (step 2.4). |
| Calendar says "Needs reconnect" | 7-day testing-mode expiry. Click **Reconnect Google**. |
| Test email: "no_recipient" | Enter an address in Settings → Nightly summary email. |
| Test email fails with a Resend 403 | Without a domain, send to the address you signed up to Resend with. |
| No nightly email | Check **Integrations → Cron → job runs**, the Vault secrets, and the `email_logs` table. |
| Supabase project paused | Free projects pause after 7 days without activity. Open the dashboard and click **Restore**; data is kept. The app keeps working offline meanwhile. |
