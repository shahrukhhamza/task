# Dayflow

A voice + text daily planner. You type or say what you need to do, Dayflow turns it into tasks, time-blocks your day around your energy, and re-plans when you fall behind.

**Status: Phase 1 (offline-first core) is complete.** Everything works without any backend or account. Phases 2–4 (Supabase sync, Google Calendar, nightly email, habits and weekly reports) are not built yet. See the [roadmap](#roadmap).

Everything here is free: no paid APIs, no LLM calls, no accounts needed. Understanding text is done by deterministic rules plus [chrono-node](https://github.com/wanasit/chrono).

## Run it

Requires Node 20+.

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # unit tests (parser, scheduler, layout)
npm run typecheck
npm run build && npm run preview   # production build, installable PWA
```

No environment variables are needed in Phase 1 (`.env.example` lists what later phases will use).

## What works today

- **Smart input bar** (bottom of the screen). Type or speak, one pipeline: input → transcript → parser → editable cards → planner.
  - Live preview of the parsed title, date/time, duration, priority, category and repeat as you type.
  - Mic button using the browser's Web Speech API, with live interim text, a language picker, and clear states for "permission denied", "no mic", "offline" and "unsupported browser" (typing keeps working).
  - Pasted lists are split into separate tasks (newlines, bullets, commas, "and").
  - Shortcuts: `#category`, `!high` `!med` `!low`, `~2h` `~30m` `~1h30m`, `@friday`.
  - `/` or `Ctrl+K` focuses the input from anywhere.
- **Parser** (`src/lib/parser`): title, deadline, fixed start/end for appointments, duration, priority, category, recurrence ("every Monday and Wednesday"), "add to my calendar" flag. Commands against existing tasks, matched with fuzzy search, with a clarifying question when two tasks fit: *push gym to tomorrow*, *I finished the assignment*, *start the assignment*, *I'm running 30 minutes late*, *what's next?*, *delete call mom*.
- **Scheduler** (`src/lib/scheduler`, pure functions): priority score from urgency, importance and age; time-blocks tasks around fixed events; hard work goes to your peak-focus window, easy work to low-energy time; breaks, buffers, chunking of long tasks, and a daily focus cap; "I'm behind" re-plan; deadline-risk warnings with suggestions; "can I finish everything today?" check; per-category estimate learning.
- **Day timeline**: today view with a current-time line, drag to move a block (15-minute snap; keyboard: focus a block and press `Alt+↑/↓`), tap for complete / skip / edit / delete, undo on every destructive action.
- **Focus timer**: Pomodoro (25/5 or 50/10) per task, distraction-free full-screen, keeps the screen awake, logs focus time.
- **Morning screen**, **Upcoming (7 days)** and a **deadline-risk panel**.
- **Settings**: timezone (default Asia/Karachi, stored per user, never hardcoded), working hours, peak window, pacing, theme, JSON/CSV export, delete all data.
- **Local-first PWA**: data lives in IndexedDB (Dexie); installable and works offline. Dark mode, responsive, keyboard-navigable.

## Example input

```
Physics assignment due Thursday, about 2 hours, high priority
Gym at 6pm, call mom, client meeting tomorrow 3 to 4
Dentist Friday 4pm add to my calendar
Study chemistry ~90m #exam !high
Team standup every weekday at 9am
```

## How it's organised

```
src/lib/parser/      text → tasks or commands (TextUnderstander interface; rule-based implementation)
src/lib/scheduler/   pure planning engine: score, slots, placement, re-plan, risk, estimates
src/lib/db/          Dexie schema and every action that changes data (all undoable)
src/lib/time/        timezone helpers; nothing in the app assumes a zone
src/features/        input bar, timeline, focus timer, morning, upcoming, task sheet
src/pages/           Today, Upcoming, Settings
tests/               Vitest suites for the parser (70+ sentences), commands and scheduler
```

The parser sits behind the `TextUnderstander` interface (`src/lib/parser/understander.ts`), so a free in-browser model could be swapped in later without touching the UI.

## Deploy for free

Phase 1 is a static site, so any free static host works.

- **Cloudflare Pages**: connect the repo, build command `npm run build`, output directory `dist`. `public/_redirects` handles client-side routing.
- **Vercel**: import the repo (framework: Vite). `vercel.json` handles client-side routing.

## Known limitations

- **Voice works best in Chrome and Edge.** The Web Speech API is missing or limited in Firefox and some mobile browsers, and Chrome sends audio to Google's servers, so voice needs a connection. Typing always works, offline included.
- **Parsing is English-only.** You can pick other voice languages and they will be transcribed, but dates, priorities and commands are only understood in English.
- **The rule-based parser is not an LLM.** Unusual phrasing can be misread, which is why every task is shown as an editable card before it is added. "Meeting with Ali, Sara and Omar" would be split into three items, for example.
- **Reminders and notifications are not built yet** (Phase 3). Browser notifications without a push server are best-effort, especially on iOS.
- **Estimate learning needs history.** It only starts correcting a category after three tasks in it were finished with the focus timer.
- **Data is per device** until Phase 2 adds sync. Use Settings → Export to back it up.
- **Dragging a block pins it**, so the planner leaves it where you put it, even through a re-plan.
- When Phase 2 arrives: Google OAuth tokens expire after 7 days while the Google app is in "Testing" mode, and free Supabase projects pause after a week of inactivity. The README will cover both.

## Roadmap

| Phase | Scope | Status |
|---|---|---|
| 1 | Offline-first core: input, parser, scheduler, timeline, PWA | Done |
| 2 | Supabase auth + sync, RLS, Google sign-in, Calendar read/write, `.ics` fallback | Not started |
| 3 | Nightly email (Edge Function + pg_cron + Resend), email settings, reminders | Not started |
| 4 | Habits and streaks, check-ins, weekly report, polish, deployment docs | Not started |
