import { CalendarDays, Check } from 'lucide-react';
import { completeTask } from '../../lib/db/actions';
import { formatDuration, formatTime, MIN } from '../../lib/time/tz';
import { useUi } from '../../store/ui';
import type { DayItem } from './dayItems';

const DOT: Record<string, string> = {
  study: 'bg-card-lilac',
  work: 'bg-card-sky',
  fitness: 'bg-card-lime',
  health: 'bg-card-coral',
  finance: 'bg-card-sun',
  social: 'bg-card-coral',
  home: 'bg-card-cream',
  personal: 'bg-card-lime',
};

function timeParts(ts: number, tz: string) {
  const [clock, ampm] = formatTime(ts, tz).split(' ');
  return { clock, ampm };
}

/** A calm, tappable list of the day: time on the left, one tap to finish. */
export function DayList({ items, tz, now }: { items: DayItem[]; tz: string; now: number }) {
  const select = useUi((s) => s.select);
  const toast = useUi((s) => s.toast);

  return (
    <ul className="grid gap-2.5">
      {items.map((item) => {
        const { clock, ampm } = timeParts(item.start, tz);
        const current = item.start <= now && now < item.end;
        const missed = item.kind === 'block' && item.end <= now;
        const category = item.task?.category ?? 'general';
        const meta = [
          formatDuration((item.end - item.start) / MIN),
          item.kind === 'event' ? 'Calendar' : item.kind === 'appointment' ? 'Appointment' : category === 'general' ? '' : category,
          item.block && item.block.chunks > 1 ? `part ${item.block.chunk} of ${item.block.chunks}` : '',
        ].filter(Boolean);

        return (
          <li key={item.key}>
            <div
              className={`flex items-center gap-3 rounded-[22px] p-3 pr-3.5 transition ${
                current ? 'bg-card-lime text-ink' : 'bg-surface text-fg'
              } ${missed ? 'opacity-70' : ''}`}
            >
              <div className={`flex w-14 shrink-0 flex-col items-center rounded-2xl py-2 leading-none ${current ? 'bg-ink text-white' : 'bg-surface-2'}`}>
                <span className="text-[15px] font-bold">{clock}</span>
                <span className="mt-1 text-[10px] font-bold opacity-70">{ampm}</span>
              </div>

              <button
                type="button"
                disabled={!item.task}
                onClick={() => item.task && select(item.task.id)}
                className="min-w-0 flex-1 text-left disabled:cursor-default"
                aria-label={`${item.title}, ${formatTime(item.start, tz)} to ${formatTime(item.end, tz)}${current ? ', happening now' : ''}${missed ? ', missed' : ''}. Open details`}
              >
                <span className="flex items-center gap-2">
                  {item.kind !== 'event' && <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${DOT[category] ?? 'bg-card-mist'} ring-1 ring-black/10`} aria-hidden />}
                  {item.kind === 'event' && <CalendarDays size={14} className="shrink-0 opacity-70" aria-hidden />}
                  <span className="truncate text-[16px] font-bold">{item.title}</span>
                </span>
                <span className={`mt-0.5 block truncate text-sm ${current ? 'opacity-75' : 'text-muted'}`}>
                  {current ? 'Now · ' : ''}
                  {missed ? 'Missed · ' : ''}
                  {meta.join(' · ')}
                </span>
              </button>

              {item.task && item.kind !== 'event' ? (
                <button
                  type="button"
                  aria-label={`Mark ${item.title} done`}
                  onClick={async () => {
                    const undo = await completeTask(item.task!.id);
                    toast(`Done: “${item.title}”. Nice.`, { undo });
                  }}
                  className={`group flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-2 transition ${
                    current ? 'border-ink hover:bg-ink hover:text-white' : 'border-fg/25 hover:border-fg hover:bg-fg hover:text-app'
                  }`}
                >
                  <Check size={18} strokeWidth={3} className="opacity-0 transition group-hover:opacity-100" />
                </button>
              ) : (
                <span className="w-10 shrink-0" aria-hidden />
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
