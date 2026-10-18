import { CalendarMinus, CalendarPlus, Download, ExternalLink } from 'lucide-react';
import { Button } from '../../components/ui';
import { eventTiming, googleTemplateUrl } from '../../lib/calendar/event';
import { buildIcs } from '../../lib/calendar/ics';
import { setAddToCalendar } from '../../lib/db/actions';
import { download } from '../../lib/download';
import type { Task } from '../../lib/types';
import { useCloud } from '../../store/cloud';
import { useUi } from '../../store/ui';

const fileName = (title: string) => `${title.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').toLowerCase() || 'task'}.ics`;

/** Google sync when connected; otherwise a template link and an .ics file, which need no account. */
export function CalendarActions({ task, timezone }: { task: Task; timezone: string }) {
  const connected = useCloud((s) => s.google === 'connected' && !!s.user);
  const toast = useUi((s) => s.toast);
  const timing = eventTiming(task);

  if (!timing) {
    return <p className="text-xs text-slate-600 dark:text-slate-400">Calendar options appear once this task has a time or a deadline.</p>;
  }

  const linked = !!task.calendarEventId;
  const template = googleTemplateUrl(task, timezone);

  return (
    <div className="grid gap-2">
      <p className="text-xs font-medium text-slate-600 dark:text-slate-400">Calendar</p>
      <div className="flex flex-wrap gap-2">
        {connected &&
          (task.addToCalendar ? (
            <Button
              size="sm"
              onClick={async () => {
                const undo = await setAddToCalendar(task.id, false);
                toast('Removing from Google Calendar.', { undo });
              }}
            >
              <CalendarMinus size={15} /> {linked ? 'In Google Calendar · remove' : 'Adding… · cancel'}
            </Button>
          ) : (
            <Button
              size="sm"
              variant="primary"
              onClick={async () => {
                const undo = await setAddToCalendar(task.id, true);
                toast('Adding to Google Calendar.', { undo });
              }}
            >
              <CalendarPlus size={15} /> Add to Google Calendar
            </Button>
          ))}
        {!connected && template && (
          <a
            href={template}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-lg bg-white px-2.5 py-1.5 text-xs font-medium text-slate-800 ring-1 ring-slate-300 hover:bg-slate-100 dark:bg-slate-800 dark:text-slate-100 dark:ring-slate-600 dark:hover:bg-slate-700"
          >
            <ExternalLink size={14} /> Add to Google Calendar
          </a>
        )}
        <Button size="sm" variant="ghost" onClick={() => download(fileName(task.title), buildIcs([task], timezone), 'text/calendar')}>
          <Download size={14} /> .ics file
        </Button>
      </div>
    </div>
  );
}
