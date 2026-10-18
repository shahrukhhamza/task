// Renders the nightly and weekly summary emails.
//
// Email clients are hostile to modern CSS, so this is table-based with inline styles.
// Light colours are inline (they work everywhere); a <style> block adds a dark palette for
// clients that support prefers-color-scheme (Apple Mail, iOS) and Outlook.com's
// [data-ogsc] dark mode. Gmail's apps recolour automatically; the palette is chosen so
// their inversion stays readable. Charts are plain tables with percentage widths.

import type { DayReport, WeekReport } from './analytics.ts';
import { clock, duration, hourLabel } from './zone.ts';

export interface EmailContext {
  timezone: string;
  appUrl: string;
  unsubscribeUrl: string;
  settingsUrl: string;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

export const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const C = {
  page: '#eef2f6',
  card: '#ffffff',
  text: '#0f172a',
  muted: '#475569',
  line: '#e2e8f0',
  brand: '#0f766e',
  brandSoft: '#e6f4f2',
  track: '#e2e8f0',
  good: '#047857',
  warn: '#b45309',
  bad: '#b91c1c',
};

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

const DARK_CSS = `
  :root { color-scheme: light dark; supported-color-schemes: light dark; }
  @media (prefers-color-scheme: dark) {
    .df-page { background: #020617 !important; }
    .df-card { background: #0f172a !important; border-color: #1e293b !important; }
    .df-text { color: #e2e8f0 !important; }
    .df-muted { color: #94a3b8 !important; }
    .df-line { border-color: #1e293b !important; }
    .df-soft { background: #134e4a !important; }
    .df-track { background: #1e293b !important; }
    .df-brand { color: #5eead4 !important; }
  }
  [data-ogsc] .df-page { background: #020617 !important; }
  [data-ogsc] .df-card { background: #0f172a !important; }
  [data-ogsc] .df-text { color: #e2e8f0 !important; }
  [data-ogsc] .df-muted { color: #94a3b8 !important; }
  [data-ogsc] .df-soft { background: #134e4a !important; }
  [data-ogsc] .df-brand { color: #5eead4 !important; }
  @media (max-width: 620px) {
    .df-card { border-radius: 0 !important; }
    .df-pad { padding: 20px 18px !important; }
    .df-stat { display: block !important; width: 100% !important; padding: 6px 0 !important; }
  }
`;

const scoreColor = (score: number | null) => (score === null ? C.muted : score >= 70 ? C.good : score >= 40 ? C.warn : C.bad);

function shell(preheader: string, body: string, ctx: EmailContext): string {
  return `<!doctype html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>Dayflow</title>
<style>${DARK_CSS}</style>
</head>
<body class="df-page" style="margin:0;padding:0;background:${C.page};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="df-page" style="background:${C.page};">
<tr><td align="center" style="padding:24px 12px;">
<!--[if mso]><table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="df-card" style="width:100%;max-width:600px;background:${C.card};border:1px solid ${C.line};border-radius:16px;font-family:${FONT};">
<tr><td class="df-pad" style="padding:28px 32px;">
${body}
</td></tr>
</table>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;font-family:${FONT};">
<tr><td class="df-muted" style="padding:16px 12px;color:${C.muted};font-size:12px;line-height:18px;text-align:center;">
You’re getting this because nightly summaries are on in Dayflow.<br>
<a href="${escapeHtml(ctx.settingsUrl)}" style="color:${C.muted};">Change the time</a> &middot;
<a href="${escapeHtml(ctx.unsubscribeUrl)}" style="color:${C.muted};">Unsubscribe</a>
</td></tr>
</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr>
</table>
</body>
</html>`;
}

const h2 = (text: string) =>
  `<h2 class="df-text" style="margin:28px 0 10px;font-size:15px;line-height:20px;color:${C.text};font-weight:700;">${text}</h2>`;

const muted = (text: string) => `<p class="df-muted" style="margin:0;font-size:14px;line-height:20px;color:${C.muted};">${text}</p>`;

function rows(items: string[][], alignLast = true): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${items
    .map(
      (cells) =>
        `<tr>${cells
          .map(
            (cell, i) =>
              `<td class="${i === 0 ? 'df-text' : 'df-muted'} df-line" style="padding:8px 0;border-bottom:1px solid ${C.line};font-size:14px;line-height:20px;color:${i === 0 ? C.text : C.muted};${
                i > 0 && alignLast ? 'text-align:right;white-space:nowrap;padding-left:12px;' : ''
              }">${cell}</td>`,
          )
          .join('')}</tr>`,
    )
    .join('')}</table>`;
}

function bars(items: Array<{ label: string; minutes: number }>): string {
  const max = Math.max(...items.map((i) => i.minutes), 1);
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${items
    .slice(0, 6)
    .map((item) => {
      const pct = Math.max(2, Math.round((item.minutes / max) * 100));
      return `<tr>
<td class="df-text" style="padding:5px 10px 5px 0;font-size:13px;color:${C.text};white-space:nowrap;width:90px;text-transform:capitalize;">${escapeHtml(item.label)}</td>
<td style="padding:5px 0;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
<td class="df-track" style="background:${C.track};border-radius:4px;height:10px;line-height:10px;font-size:0;">
<table role="presentation" width="${pct}%" cellpadding="0" cellspacing="0" border="0"><tr><td style="background:${C.brand};border-radius:4px;height:10px;line-height:10px;font-size:0;">&nbsp;</td></tr></table>
</td></tr></table>
</td>
<td class="df-muted" style="padding:5px 0 5px 10px;font-size:13px;color:${C.muted};white-space:nowrap;text-align:right;width:56px;">${duration(item.minutes)}</td>
</tr>`;
    })
    .join('')}</table>`;
}

function stat(label: string, value: string): string {
  return `<td class="df-stat" width="33%" valign="top" style="padding:0 6px 0 0;">
<div class="df-muted" style="font-size:12px;line-height:16px;color:${C.muted};text-transform:uppercase;letter-spacing:.04em;">${label}</div>
<div class="df-text" style="font-size:20px;line-height:28px;color:${C.text};font-weight:700;">${value}</div>
</td>`;
}

const button = (href: string, label: string) =>
  `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:28px;"><tr><td style="background:${C.brand};border-radius:10px;">
<a href="${escapeHtml(href)}" style="display:inline-block;padding:12px 20px;font-family:${FONT};font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;">${label}</a>
</td></tr></table>`;

const insightBox = (text: string) =>
  `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:24px;"><tr>
<td class="df-soft" style="background:${C.brandSoft};border-radius:12px;padding:14px 16px;">
<div class="df-brand" style="font-size:12px;line-height:16px;color:${C.brand};font-weight:700;text-transform:uppercase;letter-spacing:.04em;">Insight of the day</div>
<div class="df-text" style="margin-top:4px;font-size:14px;line-height:21px;color:${C.text};">${escapeHtml(text)}</div>
</td></tr></table>`;

const header = (kicker: string, title: string) =>
  `<div class="df-brand" style="font-size:13px;line-height:18px;color:${C.brand};font-weight:700;">Dayflow &middot; ${escapeHtml(kicker)}</div>
<h1 class="df-text" style="margin:6px 0 0;font-size:22px;line-height:28px;color:${C.text};">${escapeHtml(title)}</h1>`;

// ------------------------------------------------------------------ daily

export function renderDailyEmail(r: DayReport, ctx: EmailContext): RenderedEmail {
  const tz = ctx.timezone;
  const scoreText = r.score === null ? '–' : `${r.score}%`;
  const parts: string[] = [header(r.label, r.headline)];

  parts.push(`<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:18px;"><tr>
<td style="font-size:44px;line-height:48px;font-weight:800;color:${scoreColor(r.score)};font-family:${FONT};">${scoreText}</td>
<td class="df-muted" style="padding-left:12px;font-size:14px;line-height:20px;color:${C.muted};">day score<br>${r.completedCount} of ${r.planned} planned tasks done</td>
</tr></table>`);

  if (r.completed.length) {
    parts.push(h2(`Completed (${r.completed.length})`));
    parts.push(rows(r.completed.map((c) => [escapeHtml(c.title), `${duration(c.plannedMin)} planned · ${c.actualMin === null ? 'not timed' : `${duration(c.actualMin)} actual`}`])));
  }
  if (r.missed.length) {
    parts.push(h2(`Missed (${r.missed.length})`));
    parts.push(rows(r.missed.map((m) => [escapeHtml(m.title), `${duration(m.plannedMin)} planned`])));
  }
  if (r.rescheduled.length) {
    parts.push(h2(`Rescheduled (${r.rescheduled.length})`));
    parts.push(rows(r.rescheduled.map((m) => [escapeHtml(m.title), m.times > 1 ? `moved ${m.times}×` : 'moved'])));
  }
  if (!r.completed.length && !r.missed.length && !r.rescheduled.length) parts.push(`<div style="margin-top:16px;">${muted('Nothing was planned for today.')}</div>`);

  if (r.categories.length) {
    parts.push(h2('Where your time went'));
    parts.push(bars(r.categories.map((c) => ({ label: c.category, minutes: c.minutes }))));
  }

  parts.push(h2('Focus'));
  parts.push(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
${stat('Total focus', r.focus.totalMin ? duration(r.focus.totalMin) : '–')}
${stat('Longest streak', r.focus.longestStreakMin ? duration(r.focus.longestStreakMin) : '–')}
${stat('Best hour', r.focus.productiveHour === null ? '–' : hourLabel(r.focus.productiveHour))}
</tr></table>`);
  if (!r.focus.totalMin) parts.push(`<div style="margin-top:6px;">${muted('Use the focus timer to see real time spent here.')}</div>`);

  parts.push(insightBox(r.insight));

  parts.push(h2('Tomorrow'));
  parts.push(
    r.tomorrow.length
      ? rows(r.tomorrow.map((t) => [`${escapeHtml(t.title)}${t.kind === 'event' ? ' <span style="opacity:.7">(calendar)</span>' : ''}`, `${clock(t.start, tz)} – ${clock(t.end, tz)}`]))
      : muted('Nothing planned yet. Add a few tasks tonight and Dayflow will lay out your morning.'),
  );

  if (r.deadlines.length) {
    parts.push(h2('Deadlines in the next 3 days'));
    parts.push(rows(r.deadlines.map((d) => [escapeHtml(d.title), d.daysLeft === 1 ? 'tomorrow' : `in ${d.daysLeft} days`])));
  }

  parts.push(button(ctx.appUrl, 'Open Dayflow'));

  const subject = r.score === null ? `Your day in Dayflow · ${r.label}` : `Your day: ${r.score}% · ${r.completedCount} of ${r.planned} done`;
  return { subject, html: shell(`${r.headline} ${r.insight}`, parts.join('\n'), ctx), text: dailyText(r, ctx) };
}

function dailyText(r: DayReport, ctx: EmailContext): string {
  const tz = ctx.timezone;
  const lines = [`Dayflow · ${r.label}`, r.headline, r.score === null ? '' : `Day score: ${r.score}%`, ''];
  const list = (title: string, items: string[]) => {
    if (!items.length) return;
    lines.push(title, ...items.map((i) => `  - ${i}`), '');
  };
  list('Completed', r.completed.map((c) => `${c.title} (${duration(c.plannedMin)} planned${c.actualMin === null ? '' : `, ${duration(c.actualMin)} actual`})`));
  list('Missed', r.missed.map((m) => m.title));
  list('Rescheduled', r.rescheduled.map((m) => m.title));
  list('Time by category', r.categories.map((c) => `${c.category}: ${duration(c.minutes)}`));
  lines.push(`Focus: ${duration(r.focus.totalMin)} total, longest streak ${duration(r.focus.longestStreakMin)}`, '', `Insight: ${r.insight}`, '');
  list('Tomorrow', r.tomorrow.map((t) => `${clock(t.start, tz)} ${t.title}`));
  list('Deadlines in the next 3 days', r.deadlines.map((d) => `${d.title} (${d.daysLeft === 1 ? 'tomorrow' : `in ${d.daysLeft} days`})`));
  lines.push(`Open Dayflow: ${ctx.appUrl}`, `Unsubscribe: ${ctx.unsubscribeUrl}`);
  return lines.filter((l, i, all) => !(l === '' && all[i - 1] === '')).join('\n');
}

// ------------------------------------------------------------------ weekly

export function renderWeeklyEmail(w: WeekReport, ctx: EmailContext): RenderedEmail {
  const parts: string[] = [header('Your week', w.averageScore === null ? 'Your week in review' : `Average day score: ${w.averageScore}%`)];

  const delta = (now: number | null, before: number | null, unit: (n: number) => string) => {
    if (now === null || before === null || before === 0) return '';
    const diff = now - before;
    if (Math.abs(diff) < 1) return ' (same as last week)';
    return ` (${diff > 0 ? '+' : '−'}${unit(Math.abs(diff))} vs last week)`;
  };

  parts.push(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:18px;"><tr>
${stat('Tasks done', `${w.completed}/${w.planned}`)}
${stat('Focus', w.focusMin ? duration(w.focusMin) : '–')}
${stat('Best day', w.bestDay ? `${escapeHtml(w.bestDay.label.split(',')[0])} ${w.bestDay.score}%` : '–')}
</tr></table>`);
  parts.push(
    `<div style="margin-top:8px;">${muted(
      `Average score${delta(w.averageScore, w.previousAverageScore, (n) => `${Math.round(n)} pts`) || ': no comparison yet'} · Focus${delta(w.focusMin, w.previousFocusMin, duration) || ': no comparison yet'}`,
    )}</div>`,
  );

  parts.push(h2('Day by day'));
  const maxScore = 100;
  parts.push(
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>${w.days
      .map((d) => {
        const h = d.score === null ? 0 : Math.max(4, Math.round((d.score / maxScore) * 80));
        return `<td align="center" valign="bottom" width="14%" style="width:14%;padding:0 3px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td class="df-track" valign="bottom" style="background:${C.track};height:80px;border-radius:6px;font-size:0;line-height:0;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="background:${scoreColor(d.score)};height:${h}px;line-height:${h}px;border-radius:6px;font-size:0;">&nbsp;</td></tr></table>
</td></tr></table>
<div class="df-muted" style="margin-top:6px;font-size:12px;color:${C.muted};">${d.label}</div>
<div class="df-text" style="font-size:12px;font-weight:600;color:${C.text};">${d.score === null ? '–' : `${d.score}%`}</div>
</td>`;
      })
      .join('')}</tr></table>`,
  );

  if (w.categories.length) {
    parts.push(h2('Where your time went'));
    parts.push(bars(w.categories.map((c) => ({ label: c.category, minutes: c.minutes }))));
  }

  if (w.habits.length) {
    parts.push(h2('Habits'));
    parts.push(rows(w.habits.map((h) => [escapeHtml(h.title), `${h.done}/${h.scheduled} days${h.streak ? ` · ${h.streak}-day streak` : ''}`])));
  }

  if (w.mood !== null || w.energy !== null) {
    parts.push(h2('How you felt'));
    parts.push(muted(`Average mood ${w.mood?.toFixed(1) ?? '–'} / 5 · average energy ${w.energy?.toFixed(1) ?? '–'} / 5`));
  }

  parts.push(insightBox(w.insight).replace('Insight of the day', 'This week’s insight'));
  parts.push(button(`${ctx.appUrl.replace(/\/$/, '')}/report`, 'See the full report'));

  const subject = `Your week: ${w.averageScore === null ? 'review' : `${w.averageScore}% average`}${w.focusMin ? ` · ${duration(w.focusMin)} focus` : ''}`;
  const text = [
    `Dayflow · Your week (${w.start} to ${w.end})`,
    `Tasks done: ${w.completed}/${w.planned}`,
    `Average day score: ${w.averageScore ?? '–'}%`,
    `Focus: ${duration(w.focusMin)} (last week ${duration(w.previousFocusMin)})`,
    '',
    ...w.days.map((d) => `  ${d.label}: ${d.score === null ? '–' : `${d.score}%`}`),
    '',
    ...w.categories.map((c) => `${c.category}: ${duration(c.minutes)}`),
    '',
    `Insight: ${w.insight}`,
    '',
    `Full report: ${ctx.appUrl.replace(/\/$/, '')}/report`,
    `Unsubscribe: ${ctx.unsubscribeUrl}`,
  ].join('\n');
  return { subject, html: shell(w.insight, parts.join('\n'), ctx), text };
}
