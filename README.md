# Dayflow

A voice + text daily planner and companion. Type or say what you need to do; Dayflow turns
it into tasks, time-blocks your day around your energy, re-plans when you fall behind,
syncs with Google Calendar, and emails you a summary every night.

- **Free to run.** No paid APIs and no credit card anywhere. Text is understood by a built-in
  parser (chrono-node + rules) that works offline; an optional **smart assistant** powered by
  Google Gemini's free tier makes it understand anything, in any language.
- **Local-first.** Everything works offline in the browser. Cloud features (sync, Google
  Calendar, email, background reminders) switch on when you add free Supabase keys.
- **Installable PWA** for phone and desktop.

## Quick start

Requires Node 20+.

```bash
npm install
npm run dev          # http://localhost:5173, fully working with no setup
npm test             # unit + integration tests
npm run typecheck
npm run build        # production build into dist/
```

To switch on sign-in, sync, Google Calendar, nightly emails and closed-app reminders,
follow **[docs/SETUP.md](docs/SETUP.md)**. It walks through every free account and key step by step.

## Features

**Smart input (text and voice, one pipeline)**: input → transcript → parser → editable
cards → planner.
- Live preview of what was understood as you type; edit any card before it's added.
- Mic with live transcript, language picker, and clear states for denied permission,
  no mic, offline and unsupported browsers.
- Pasted lists split into tasks. Shortcuts: `#category`, `!high|!med|!low`, `~2h`, `@friday`.
- Commands: *push gym to tomorrow*, *I finished the assignment*, *start the assignment*,
  *I'm running 30 minutes late*, *what's next?*, *delete call mom*, *add gym to my calendar*.
  Targets are fuzzy-matched; Dayflow asks when two tasks fit.
- `habit: read 20 pages every weekday` creates a habit. `/` or `Ctrl+K` focuses the input.

**Planning engine** (`src/lib/scheduler`, pure functions)
- Priority from urgency (time to deadline vs. work left), importance and age.
- Hard work goes in your peak-focus window, easy work in low-energy time; breaks, buffers,
  chunking of long tasks, a daily focus cap; never overlaps fixed events or calendar events.
- "I'm behind" re-packs the rest of the day; deadline-risk warnings ("At this pace you'll
  miss Thursday's deadline") with one-tap fixes (move or drop lower-priority work).
- Learns how long your tasks really take per category and adjusts future plans.

**Day to day**
- Today timeline with a now-line, drag (or `Alt+↑/↓`) to move blocks, tap to complete,
  skip, edit or delete, and undo on everything destructive.
- Pomodoro focus timer in a distraction-free full screen.
- Morning summary with carried-over tasks and a "can I finish everything?" check.
- Upcoming 7 days and a deadline panel; habits with streaks; evening mood/energy check-in.
- Weekly "where did my time go" report with charts (each with a table view).
- Push notifications on your phone, even with the app closed (needs the free Supabase setup,
  see [docs/PHONE_PUSH.md](docs/PHONE_PUSH.md)): a reminder before each task, a morning plan,
  deadline alerts and an evening wrap-up, each switchable in Settings → Notifications, with a
  "Send a test to this phone" button.

**Voice assistant** (*Talk to Dayflow*: sidebar, the floating mic on phones, or press `V`)
- Hands-free: it listens, waits for a pause, acts at once and answers out loud, then listens
  again. "Add a meeting from 5 to 6 pm" creates the task; "remove this" deletes the one you
  were just talking about; "undo" takes it back; "what's on today?" reads your day.
- Every task wears a small number (soonest first). Say *task 2*, *number 3* or *the second task*:
  "update task 2 to 7 pm", "delete number 3", "mark task 1 as done".
- Understands *this / it / that one*, asks "which one?" when two tasks fit (answer "the second
  one" or by name), warns about overlaps, and follows am/pm exactly ("8 AM to 9PM" is 13 hours).
- Uses Gemini when it's on, the built-in parser otherwise. Spoken answers can be muted.

**Smart assistant (optional, Gemini free tier)**
- Understands free-form input in any language (English, Urdu, Roman Urdu, Hindi…), including
  voice typos, and returns structured tasks, commands or habits for you to confirm.
- "Break it down" turns a big task into 2–6 timed steps.
- A two-sentence daily brief on Today, and a deeper weekly look on Progress.
- Every AI feature falls back silently to the built-in logic when it's off, offline, or out of
  quota. Turn it on in Settings → Smart assistant with a free key (docs/SETUP.md step 0).

**Cloud (optional)**
- Google sign-in; two-way sync to Supabase with row level security on every table.
- Google Calendar: your events block time in the plan; tasks can be added to the calendar
  and stay in sync (updates, deletes). Without signing in: `.ics` files and
  "Add to Google Calendar" links.
- Nightly HTML email at your chosen local time (score, done/missed/rescheduled, planned vs.
  actual, time by category, focus stats, an insight, tomorrow's plan, upcoming deadlines),
  a weekly edition on Sundays, test send, and one-click unsubscribe.
- JSON and CSV export at any time.

## Project layout

```
src/
  lib/parser/        text → tasks/commands (TextUnderstander interface, rule-based impl.)
  lib/scheduler/     planning engine: scoring, slots, placement, re-plan, risk, estimates
  lib/db/            Dexie schema and every data-changing action (undoable)
  lib/sync/          local-first sync engine + Supabase remote
  lib/calendar/      Google payloads, .ics export, calendar import/write-back
  lib/cloud/         lazily loaded Supabase client, session, push subscription
  features/, pages/  UI (React + Tailwind)
  sw.ts              service worker: offline shell, push, notification clicks
supabase/
  migrations/        0001 schema + RLS, 0002 pg_cron jobs
  functions/         google-calendar, daily-summary, send-reminders, push-test, ai (+ _shared pure code)
tests/               Vitest suites (parser, scheduler, sync, SQL/RLS, functions, email, push)
docs/SETUP.md        free credentials and deployment, step by step
```

Shared logic in `supabase/functions/_shared` (analytics, email rendering, timezone helpers,
Web Push) is plain TypeScript, used by both the Edge Functions and the app's report page.

## Environment variables

App (`.env.local`, see `.env.example`): `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`,
`VITE_VAPID_PUBLIC_KEY`. All optional. The Gemini key is **not** an env var: it is entered in
Settings and stays on the device (a key built into a public website could be copied by anyone).

Edge Functions (`supabase/functions/.env`, see its `.env.example`): `GOOGLE_CLIENT_ID`,
`GOOGLE_CLIENT_SECRET`, `RESEND_API_KEY`, `EMAIL_FROM`, `APP_URL`, `CRON_SECRET`,
`UNSUBSCRIBE_SECRET`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, and optionally
`GEMINI_API_KEY` / `GEMINI_MODEL` for the `ai` function.

No secret is ever committed; both env files are git-ignored.

## Deploying for free

The app is a static site: build command `npm run build`, output `dist`.
- **Vercel**: import the repo (framework Vite). `vercel.json` handles routing.
- **Cloudflare Pages**: connect the repo with the settings above. `public/_redirects` handles routing.

Backend: one free Supabase project (database, auth, Edge Functions, pg_cron). Full steps in
[docs/SETUP.md](docs/SETUP.md).

## How it was verified

- 331 automated tests: parser (70+ sentences) and commands, scheduler, timezone/DST, sync
  conflicts and offline edits, the SQL migrations and row level security in an embedded
  Postgres (PGlite), all three Edge Function handlers against mocked Google/Resend/push
  services, email rendering, and Web Push encryption against the RFC 8291 test vector.
- Edge Functions type-checked with Deno; the app with `tsc` (strict).
- Browser runs in Edge (Playwright): every flow, offline reload, reminders, and an axe
  accessibility audit of every page in light and dark mode with no violations.

**Not yet verified against the live services**: nothing has run against a real Supabase
project, Google account, Resend or a push service, because no credentials exist yet. Expect
the first live run (docs/SETUP.md step 8) to be the real integration test.

## Known limitations

- **Google testing mode**: refresh tokens expire after 7 days while the OAuth app is in
  "Testing". Dayflow shows a one-click **Reconnect Google** prompt. Publishing the app needs
  Google's (free) verification for the Calendar scope.
- **Supabase free projects pause** after 7 days without activity. Restore from the dashboard;
  data is kept, and Dayflow keeps working offline in the meantime.
- **Voice works best in Chrome and Edge.** The Web Speech API is missing in Firefox and
  limited on some mobile browsers, and Chrome sends audio to Google's speech service, so voice
  needs a connection. Typing always works.
- **Without the smart assistant, parsing is English-only.** Other voice languages are
  transcribed but only understood once Gemini is on.
- **Gemini free tier**: limits are set (and changed) by Google, and on the free tier Google may
  use prompts to improve its products. Dayflow sends only what's needed: your message, today's
  plan for the brief, or a weekly summary. Model names change often, so Dayflow picks the best
  available Flash model for your key automatically.
- **The parser is rule-based**, so unusual phrasing can be misread. That's why every task is
  shown as an editable card first. Commas split lists, so "meet Ali, Sara and Omar" becomes
  several items.
- **Resend without a domain** only delivers to the email you signed up to Resend with.
- **Email timing**: the job runs every 15 minutes, so a 21:30 email arrives by about 21:45.
  Dark mode in email depends on the client; Gmail recolours on its own.
- **Push on iPhone** requires adding Dayflow to the Home Screen (iOS 16.4+).
- **Sync is last-write-wins per row**: if the same task is edited on two offline devices,
  the later edit wins.
- **Calendar**: a flexible task appears in Google at its first planned block, and all-day
  Google events don't block time.
